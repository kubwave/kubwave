<script setup lang="ts">
import { Box, Braces, Cpu, Globe, Settings2, ShieldAlert } from 'lucide-vue-next';
import type { Service } from '~/utils/types';
import { snapshot, makeServiceSettingsSchema, type ServiceSettingsValues } from '~/composables/use-service-settings-schema';
import { isDatabaseEngine } from '~/utils/database-engines';
import { SERVICE_SETTINGS_ERRORS } from '~/components/service/settings/service-settings-context';

// Consumed by the service DetailDrawer; delete is handled here (confirm + API + toast).
const props = defineProps<{ service: Service }>();
const emit = defineEmits<{ saved: [Service]; deleted: [string] }>();

const toast = useToast();
const confirm = useConfirm();
const { update } = useServiceSettings(() => props.service);
const deleteService = useDeleteService(() => props.service.environmentId);

const originalVolumeSizes = computed<Record<string, string>>(() =>
	Object.fromEntries((props.service.config.volumes ?? []).map(v => [v.name, v.size]))
);

const settingsSchema = computed(() => makeServiceSettingsSchema(props.service.type, originalVolumeSizes.value));

// Plain reactive draft validated against the Zod schema directly — vee-validate's readonly `values` can't carry the dynamic env/secret/volume arrays.
const state = reactive<ServiceSettingsValues>(snapshot(props.service));

// Baseline used for the dirty check; reset whenever a save lands or the user discards.
const baseline = ref<string>(JSON.stringify(state));

const saving = ref(false);

// Validation runs only once the user has tried to save, so pristine forms stay quiet.
const submitted = ref(false);

// Flat `path -> first message` map from the schema; drives field messages, the rail badges and navigation.
const errors = computed<Record<string, string>>(() => {
	if (!submitted.value) return {};
	const result = settingsSchema.value.safeParse(state);
	if (result.success) return {};
	const map: Record<string, string> = {};
	for (const issue of result.error.issues) {
		const path = issue.path.join('.');
		if (!(path in map)) map[path] = issue.message;
	}
	return map;
});

// Sections read their per-field message via inject(SERVICE_SETTINGS_ERRORS).
provide(SERVICE_SETTINGS_ERRORS, errors);

function seed(service: Service) {
	Object.assign(state, snapshot(service));
	baseline.value = JSON.stringify(state);
	submitted.value = false;
}

// Re-snapshot if the service prop swaps to a different one underneath us.
watch(
	() => props.service.id,
	() => {
		seed(props.service);
		group.value = 'general';
	}
);

const dirty = computed(() => JSON.stringify(state) !== baseline.value);

const GROUPS = [
	{ key: 'general', label: 'General', icon: Settings2 },
	{ key: 'source', label: 'Source', icon: Box },
	{ key: 'resources', label: 'Resources & scaling', icon: Cpu },
	{ key: 'networking', label: 'Networking', icon: Globe },
	{ key: 'variables', label: 'Variables', icon: Braces },
	{ key: 'danger', label: 'Danger zone', icon: ShieldAlert }
] as const;

type GroupKey = (typeof GROUPS)[number]['key'];

// Managed databases hide networking and resources/scaling (fixed port, no scaling; storage lives in Source).
const isDatabase = computed(() => isDatabaseEngine(props.service.type));
const DATABASE_GROUP_KEYS: GroupKey[] = ['general', 'source', 'variables', 'danger'];
const visibleGroups = computed(() => (isDatabase.value ? GROUPS.filter(g => DATABASE_GROUP_KEYS.includes(g.key)) : [...GROUPS]));

const group = ref<GroupKey>('general');

// reka Select hands back a loosely-typed value; this proxy keeps `group` strongly typed.
const groupModel = computed<string>({
	get: () => group.value,
	set: value => {
		group.value = value as GroupKey;
	}
});

function groupForPath(path: string): GroupKey {
	const head = path.split('.')[0] ?? '';
	if (head === 'name' || head === 'description') return 'general';
	if (head === 'resources' || head === 'autoscaling' || head === 'volumes' || head === 'configFiles') return 'resources';
	if (head === 'healthCheck' || head === 'domains' || head === 'defaultDomainEnabled') return 'networking';
	if (head === 'env' || head === 'secrets') return 'variables';
	return 'source';
}

// Number of sections with unsaved edits — drives the save-bar label.
const changedGroupCount = computed(() => {
	if (!dirty.value) return 0;
	let base: Record<string, unknown>;
	try {
		base = JSON.parse(baseline.value) as Record<string, unknown>;
	} catch {
		return 1;
	}
	const changed = new Set<GroupKey>();
	for (const key of Object.keys(state)) {
		const k = key as keyof ServiceSettingsValues;
		if (JSON.stringify(state[k]) !== JSON.stringify(base[key])) changed.add(groupForPath(key));
	}
	return changed.size || 1;
});

const groupErrors = computed<Record<GroupKey, number>>(() => {
	const counts: Record<GroupKey, number> = { general: 0, source: 0, resources: 0, networking: 0, variables: 0, danger: 0 };
	for (const path of Object.keys(errors.value)) counts[groupForPath(path)] += 1;
	return counts;
});

const groupSelectItems = computed(() =>
	visibleGroups.value.map(g => ({
		label: groupErrors.value[g.key] ? `${g.label} (${groupErrors.value[g.key]})` : g.label,
		value: g.key
	}))
);

// A volume pins the service to one instance — coerce the toggle off when volumes exist.
const hasVolumes = computed(() => state.volumes.length > 0);
watch([hasVolumes, () => state.autoscaling.enabled], ([vols, asOn]) => {
	if (vols && asOn) state.autoscaling.enabled = false;
});
watch(
	() => state.containerPort,
	port => {
		if (!port.trim()) state.defaultDomainEnabled = false;
	}
);

const isRepoType = computed(() => props.service.type === 'public-repo' || props.service.type === 'private-repo');

function addEnv() {
	state.env.push({ _id: crypto.randomUUID(), key: '', value: '' });
}

function removeEnv(index: number) {
	state.env.splice(index, 1);
}

function addSecret() {
	state.secrets.push({ _id: crypto.randomUUID(), key: '', value: '', hasValue: false });
}

function removeSecret(index: number) {
	const [removed] = state.secrets.splice(index, 1);
	if (removed) delete shownSecrets[removed._id];
}

function addDomain() {
	state.domains.push({ _id: crypto.randomUUID(), host: '', port: state.containerPort || '' });
}

function removeDomain(index: number) {
	state.domains.splice(index, 1);
}

function addVolume() {
	state.volumes.push({ _id: crypto.randomUUID(), name: '', mountPath: '', size: '1Gi', subPath: '' });
}

function removeVolume(index: number) {
	state.volumes.splice(index, 1);
}

function addConfigFile() {
	state.configFiles.push({ _id: crypto.randomUUID(), path: '', content: '' });
}

function removeConfigFile(index: number) {
	state.configFiles.splice(index, 1);
}

function addCommand() {
	state.command.push({ _id: crypto.randomUUID(), value: '' });
}

function removeCommand(index: number) {
	state.command.splice(index, 1);
}

function addArg() {
	state.args.push({ _id: crypto.randomUUID(), value: '' });
}

function removeArg(index: number) {
	state.args.splice(index, 1);
}

function resetToBaseline() {
	seed(props.service);
}

// Per-row show/hide for secret values.
const shownSecrets = reactive<Record<string, boolean>>({});

function toggleSecret(id: string) {
	shownSecrets[id] = !shownSecrets[id];
}

function buildConfig(values: ServiceSettingsValues) {
	const port = values.containerPort.trim();
	const hc = values.healthCheck;

	const healthCheck = hc.enabled
		? {
				enabled: true,
				type: hc.type,
				...(hc.type === 'http' ? { path: hc.path.trim() } : {}),
				...(hc.port.trim() ? { port: Number(hc.port) } : {}),
				...(hc.initialDelaySeconds.trim() ? { initialDelaySeconds: Number(hc.initialDelaySeconds) } : {}),
				...(hc.periodSeconds.trim() ? { periodSeconds: Number(hc.periodSeconds) } : {}),
				...(hc.timeoutSeconds.trim() ? { timeoutSeconds: Number(hc.timeoutSeconds) } : {}),
				...(hc.failureThreshold.trim() ? { failureThreshold: Number(hc.failureThreshold) } : {}),
				...(hc.successThreshold.trim() ? { successThreshold: Number(hc.successThreshold) } : {})
			}
		: { enabled: false, type: 'http' as const };

	const r = values.resources;
	const resources = {
		...(r.cpuRequest.trim() ? { cpuRequest: r.cpuRequest.trim() } : {}),
		...(r.cpuLimit.trim() ? { cpuLimit: r.cpuLimit.trim() } : {}),
		...(r.memoryRequest.trim() ? { memoryRequest: r.memoryRequest.trim() } : {}),
		...(r.memoryLimit.trim() ? { memoryLimit: r.memoryLimit.trim() } : {})
	};

	const a = values.autoscaling;
	const autoscaling = a.enabled
		? {
				enabled: true,
				...(a.minReplicas.trim() ? { minReplicas: Number(a.minReplicas) } : {}),
				...(a.maxReplicas.trim() ? { maxReplicas: Number(a.maxReplicas) } : {}),
				...(a.targetCpuUtilizationPercentage.trim() ? { targetCpuUtilizationPercentage: Number(a.targetCpuUtilizationPercentage) } : {}),
				...(a.targetMemoryUtilizationPercentage.trim() ? { targetMemoryUtilizationPercentage: Number(a.targetMemoryUtilizationPercentage) } : {})
			}
		: { enabled: false };

	const sharedConfig = {
		containerPort: port ? Number(port) : null,
		defaultDomainEnabled: values.defaultDomainEnabled && !!port,
		env: values.env.map(e => ({ key: e.key.trim(), value: e.value })).filter(e => e.key),
		secrets: values.secrets.filter(s => s.key.trim()).map(s => ({ key: s.key.trim(), value: s.hasValue && s.value === '' ? null : s.value })),
		domains: values.domains.filter(d => d.host.trim()).map(d => ({ host: d.host.trim(), port: Number(d.port) })),
		volumes: values.volumes
			.filter(v => v.name.trim())
			.map(v => ({
				name: v.name.trim(),
				mountPath: v.mountPath.trim(),
				size: v.size.trim(),
				...(v.subPath?.trim() ? { subPath: v.subPath.trim() } : {})
			})),
		healthCheck,
		...(Object.keys(resources).length > 0 ? { resources } : {}),
		autoscaling
	};

	// Narrow DB config: database/username are immutable post-create and pass through unchanged; version + storage come from the form.
	const dbConfig = {
		version: values.version.trim(),
		storage: { size: values.storage.trim() || '1Gi' },
		...('database' in props.service.config && props.service.config.database ? { database: props.service.config.database } : {}),
		...('username' in props.service.config && props.service.config.username ? { username: props.service.config.username } : {}),
		env: sharedConfig.env,
		secrets: sharedConfig.secrets,
		...(Object.keys(resources).length > 0 ? { resources } : {})
	};

	if (isDatabaseEngine(props.service.type)) return dbConfig;
	if (props.service.type === 'dockerfile') return { dockerfile: values.dockerfile.trim(), ...sharedConfig };
	if (props.service.type === 'public-repo') {
		return {
			repoUrl: values.repoUrl.trim(),
			branch: values.branch.trim(),
			builder: values.builder,
			...(values.builder === 'dockerfile' && values.dockerfilePath.trim() ? { dockerfilePath: values.dockerfilePath.trim() } : {}),
			...(values.commit.trim() ? { commit: values.commit.trim() } : {}),
			...(values.rootDirectory.trim() ? { rootDirectory: values.rootDirectory.trim() } : {}),
			...(values.builder !== 'dockerfile' && values.buildCommand.trim() ? { buildCommand: values.buildCommand.trim() } : {}),
			...(values.builder !== 'dockerfile' && values.startCommand.trim() ? { startCommand: values.startCommand.trim() } : {}),
			...sharedConfig
		};
	}
	if (props.service.type === 'private-repo') {
		return {
			repoUrl: values.repoUrl.trim(),
			branch: values.branch.trim(),
			sshKeyId: values.sshKeyId.trim(),
			builder: values.builder,
			...(values.builder === 'dockerfile' && values.dockerfilePath.trim() ? { dockerfilePath: values.dockerfilePath.trim() } : {}),
			...(values.commit.trim() ? { commit: values.commit.trim() } : {}),
			...(values.rootDirectory.trim() ? { rootDirectory: values.rootDirectory.trim() } : {}),
			...(values.builder !== 'dockerfile' && values.buildCommand.trim() ? { buildCommand: values.buildCommand.trim() } : {}),
			...(values.builder !== 'dockerfile' && values.startCommand.trim() ? { startCommand: values.startCommand.trim() } : {}),
			...sharedConfig
		};
	}
	return {
		image: values.image,
		tag: values.tag,
		...sharedConfig,
		// docker-image only: drop blank rows and the ui-only `_id` before submit.
		configFiles: values.configFiles.filter(f => f.path.trim()).map(f => ({ path: f.path.trim(), content: f.content })),
		// Container entrypoint/args override; drop blank rows, keep order.
		command: values.command.map(c => c.value.trim()).filter(Boolean),
		args: values.args.map(a => a.value.trim()).filter(Boolean)
	};
}

async function onSubmit() {
	submitted.value = true;
	const result = settingsSchema.value.safeParse(state);
	if (!result.success) {
		const firstPath = result.error.issues[0]?.path.join('.');
		if (firstPath) group.value = groupForPath(firstPath);
		return;
	}

	const config = buildConfig(result.data);
	const autoDeploy = isRepoType.value ? { autoDeploy: { enabled: result.data.autoDeploy.enabled } } : {};

	saving.value = true;
	try {
		const updated = await update.mutateAsync({ name: result.data.name, description: result.data.description, config, ...autoDeploy });
		seed(updated);
		emit('saved', updated);
		toast.success('Service saved');
	} catch (err) {
		toast.error(serviceErrorMessage(err));
	} finally {
		saving.value = false;
	}
}

async function onDelete() {
	const confirmed = await confirm({
		title: 'Delete service',
		description: `Delete ${props.service.name}? This removes it from the environment.`,
		destructive: true,
		confirmLabel: 'Delete service',
		confirmationText: props.service.name
	});

	if (!confirmed) return;

	try {
		await deleteService.mutateAsync(props.service.id);
		toast.success('Service deleted');
		emit('deleted', props.service.id);
	} catch {
		toast.error('Could not delete service.');
	}
}
</script>

<template>
	<form class="relative flex min-h-0 flex-1 flex-col" @submit.prevent="onSubmit">
		<div class="flex min-h-0 flex-1">
			<!-- Section rail (lg+); one group at a time keeps the panel readable -->
			<nav class="hidden w-54 shrink-0 flex-col gap-0.5 border-r p-3 lg:flex">
				<button
					v-for="g in visibleGroups"
					:key="g.key"
					type="button"
					:class="[
						'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors',
						group === g.key ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
					]"
					@click="group = g.key"
				>
					<component :is="g.icon" class="size-4 shrink-0" />
					<span class="flex-1 truncate text-left">{{ g.label }}</span>
					<Badge v-if="groupErrors[g.key]" variant="destructive" class="px-1.5">{{ groupErrors[g.key] }}</Badge>
				</button>
			</nav>

			<div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
				<!-- Narrow-width section picker (replaces the rail) -->
				<Select v-model="groupModel" class="lg:hidden">
					<SelectTrigger class="w-full lg:hidden">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem v-for="item in groupSelectItems" :key="item.value" :value="item.value">{{ item.label }}</SelectItem>
					</SelectContent>
				</Select>

				<div v-show="group === 'general'">
					<ServiceSettingsGeneralSection :state :saving :service />
				</div>

				<div v-show="group === 'source'" class="flex flex-col gap-6">
					<ServiceSettingsSourceSection :state :saving :service />
					<template v-if="service.type === 'docker-image'">
						<Separator />
						<ServiceSettingsCommandSection
							:state
							:saving
							:add-command="addCommand"
							:remove-command="removeCommand"
							:add-arg="addArg"
							:remove-arg="removeArg"
						/>
					</template>
				</div>

				<div v-show="group === 'resources'" class="flex flex-col gap-6">
					<ServiceSettingsResourcesSection :state :saving :service :add-volume="addVolume" :remove-volume="removeVolume" />
					<template v-if="service.type === 'docker-image'">
						<Separator />
						<ServiceSettingsConfigFilesSection :state :saving :service :add-config-file="addConfigFile" :remove-config-file="removeConfigFile" />
					</template>
				</div>

				<div v-show="group === 'networking'">
					<ServiceSettingsNetworkingSection :state :saving :service :add-domain="addDomain" :remove-domain="removeDomain" />
				</div>

				<div v-show="group === 'variables'">
					<ServiceSettingsVariablesSection
						:state
						:saving
						:service
						:shown-secrets="shownSecrets"
						:add-env="addEnv"
						:remove-env="removeEnv"
						:add-secret="addSecret"
						:remove-secret="removeSecret"
						:toggle-secret="toggleSecret"
					/>
				</div>

				<div v-show="group === 'danger'">
					<ServiceSettingsDangerSection :service @delete="onDelete" />
				</div>

				<!-- Clearance so long content scrolls clear of the floating save bar -->
				<div v-if="dirty" class="h-16 shrink-0" aria-hidden="true" />
			</div>
		</div>

		<SettingsSaveBar
			:count="changedGroupCount"
			:saving="saving"
			:can-save="dirty && !saving"
			position-class="absolute inset-x-0 bottom-4 z-20"
			@save="onSubmit"
			@discard="resetToBaseline"
		/>
	</form>
</template>
