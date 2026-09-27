<script setup lang="ts">
import {
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
	ChevronDown,
	ClipboardPaste,
	Database,
	Box,
	Globe,
	KeyRound,
	Loader2,
	Plus,
	Sparkles,
	X
} from 'lucide-vue-next';
import type { DeploymentPlanDto } from '@kubwave/api-client';
import type { Service } from '~/utils/types';
import type { RepoSourceInput } from '~/composables/use-repo-analysis';

const props = defineProps<{ environmentId: string }>();
const emit = defineEmits<{ created: [Service[]]; back: []; done: [] }>();

type SourceType = RepoSourceInput['type'];
type ReferenceKind = 'url' | 'publicUrl' | 'connectionUri' | 'env';

interface DraftEnv {
	_id: string;
	key: string;
	value: string;
	secret: boolean;
	generate: boolean;
	kind: ReferenceKind | null;
	// "db:<id>" / "svc:<id>" for planned services, "existing:<name>" for services already in the environment, LITERAL for a typed value.
	target: string;
	// For kind "env": which key of the target to copy.
	refKey: string | null;
	note: string | null;
}

interface DraftService {
	_id: string;
	// "app" builds from the repository; "image" runs a backing service (e.g. MinIO) from a container image.
	kind: 'app' | 'image';
	include: boolean;
	expanded: boolean;
	name: string;
	image: string;
	tag: string;
	args: string;
	volumes: Array<{ _id: string; name: string; mountPath: string; size: string }>;
	rootDirectory: string;
	builder: 'nixpacks' | 'dockerfile';
	dockerfilePath: string;
	buildCommand: string;
	startCommand: string;
	containerPort: string;
	watchPaths: string;
	publicDomain: boolean;
	domain: string;
	env: DraftEnv[];
	reason: string;
}

interface DraftDatabase {
	_id: string;
	name: string;
	engine: DeploymentPlanDto['databases'][number]['engine'];
}

interface DraftQuestion {
	_id: string;
	kind: 'domain' | 'values';
	title: string;
	description: string | null;
	serviceIds: string[];
	envKeys: string[];
}

// Reka's SelectItem rejects an empty value, so "type a value instead" needs a sentinel.
const LITERAL = 'literal';
const SECRET_KEY_RE = /SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|CREDENTIAL/i;
const REFERENCE_LABEL: Record<ReferenceKind, string> = {
	url: 'internal URL of',
	publicUrl: 'public URL of',
	connectionUri: 'connection URI of',
	env: 'value from'
};

const toast = useToast();
const { activeTeamId } = useTeamContext();
const analyze = useAnalyzeRepository(() => props.environmentId);
const createFromPlan = useCreateServicesFromPlan(() => props.environmentId);
const { data: existingServices } = useEnvironmentServices(() => props.environmentId);

const sourceType = ref<SourceType>('github-repo');
const installationId = ref('');
const repoFullName = ref('');
const repoUrl = ref('');
const sshKeyId = ref('');
const branch = ref('main');
const autoDeploy = ref(true);

const { data: githubInstallations } = useGitInstallations(activeTeamId);
const { data: giteaInstallations } = useGiteaInstallations(activeTeamId);
const githubInstallationId = computed(() => (sourceType.value === 'github-repo' && installationId.value) || null);
const giteaInstallationId = computed(() => (sourceType.value === 'gitea-repo' && installationId.value) || null);
const { data: githubRepos } = useGitRepos(activeTeamId, githubInstallationId);
const { data: giteaRepos } = useGiteaRepos(activeTeamId, giteaInstallationId);
const { data: sshKeys } = useTeamSshKeys(activeTeamId);

const installations = computed(() => (sourceType.value === 'github-repo' ? githubInstallations.value : giteaInstallations.value) ?? []);
const repos = computed(() => (sourceType.value === 'github-repo' ? githubRepos.value : giteaRepos.value) ?? []);

watch(sourceType, () => {
	installationId.value = '';
	repoFullName.value = '';
});
watch(installationId, () => (repoFullName.value = ''));

const source = computed<RepoSourceInput | null>(() => {
	const b = branch.value.trim();
	if (!b) return null;
	switch (sourceType.value) {
		case 'github-repo':
		case 'gitea-repo':
			return installationId.value && repoFullName.value
				? { type: sourceType.value, installationId: installationId.value, repoFullName: repoFullName.value, branch: b }
				: null;
		case 'public-repo':
			return repoUrl.value.trim() ? { type: 'public-repo', repoUrl: repoUrl.value.trim(), branch: b } : null;
		case 'private-repo':
			return repoUrl.value.trim() && sshKeyId.value
				? { type: 'private-repo', repoUrl: repoUrl.value.trim(), sshKeyId: sshKeyId.value, branch: b }
				: null;
	}
	return null;
});

const step = ref<'source' | 'questions' | 'review'>('source');
const plan = ref<{
	services: DraftService[];
	databases: DraftDatabase[];
	questions: DraftQuestion[];
	warnings: string[];
	defaultDomainBase: string | null;
} | null>(null);
// Answers to "values" questions, keyed by question id then env key; applied to every listed service on continue.
const answers = reactive<Record<string, Record<string, string>>>({});
const analyzedSource = ref<RepoSourceInput | null>(null);
const rootError = ref<string | null>(null);

function planError(err: unknown, fallback: string): string {
	const message = (err as { details?: { message?: unknown } } | null)?.details?.message;
	const detail = typeof message === 'string' ? message : null;
	switch (errorCode(err)) {
		case 'ai_not_configured':
			return 'The AI assistant is not configured. An admin can enable it under Settings → Integrations.';
		case 'analysis_in_progress':
			return 'An analysis is already running for your account.';
		case 'repository_unreachable':
			return `Could not read the repository${detail ? `: ${detail}` : '.'} Private repositories need GitHub, Gitea, or a deploy key as the source.`;
		case 'ai_invalid_output':
			return 'The model did not return a usable plan. Try again or configure a more capable model.';
		case 'ai_provider_error':
			return `The AI provider returned an error${detail ? `: ${detail}` : '.'}`;
		case 'invalid_plan':
			return detail ?? 'The plan is invalid. Check names, paths, and references.';
		default:
			return serviceErrorMessage(err, fallback);
	}
}

function isReference(entry: DraftEnv): boolean {
	return entry.kind !== null && entry.target !== LITERAL;
}

function needsValue(entry: DraftEnv): boolean {
	return !isReference(entry) && !entry.generate && !entry.value;
}

function toDraft(result: DeploymentPlanDto) {
	const databases: DraftDatabase[] = result.databases.map(database => ({ _id: crypto.randomUUID(), ...database }));
	const blank = { include: true, expanded: false, image: '', tag: '', args: '', volumes: [], domain: '', env: [] };
	const apps: DraftService[] = result.services.map(service => ({
		...blank,
		_id: crypto.randomUUID(),
		kind: 'app',
		name: service.name,
		rootDirectory: service.rootDirectory,
		builder: service.builder,
		dockerfilePath: service.dockerfilePath ?? '',
		buildCommand: service.buildCommand ?? '',
		startCommand: service.startCommand ?? '',
		containerPort: service.containerPort == null ? '' : String(service.containerPort),
		watchPaths: service.watchPaths.join('\n'),
		publicDomain: service.publicDomain,
		reason: service.reason
	}));
	const images: DraftService[] = result.images.map(image => ({
		...blank,
		_id: crypto.randomUUID(),
		kind: 'image',
		name: image.name,
		image: image.image,
		tag: image.tag,
		args: image.args.join('\n'),
		volumes: image.volumes.map(volume => ({ _id: crypto.randomUUID(), ...volume })),
		rootDirectory: '',
		builder: 'nixpacks',
		dockerfilePath: '',
		buildCommand: '',
		startCommand: '',
		containerPort: image.containerPort == null ? '' : String(image.containerPort),
		watchPaths: '',
		publicDomain: image.publicDomain,
		reason: image.reason
	}));
	const services = [...apps, ...images];
	const byName = new Map(services.map(service => [service.name, service]));

	const targetFor = (name: string): string => {
		const database = databases.find(d => d.name === name);
		if (database) return `db:${database._id}`;
		const service = byName.get(name);
		if (service) return `svc:${service._id}`;
		return existingServices.value?.some(s => s.name === name) ? `existing:${name}` : LITERAL;
	};

	[...result.services, ...result.images].forEach((service, i) => {
		services[i]!.env = service.env.map(entry => ({
			_id: crypto.randomUUID(),
			key: entry.key,
			value: entry.value ?? '',
			secret: entry.secret,
			generate: entry.generate,
			kind: entry.reference?.kind ?? null,
			target: entry.reference ? targetFor(entry.reference.service) : LITERAL,
			refKey: entry.reference?.key ?? null,
			note: entry.note
		}));
	});

	const questions: DraftQuestion[] = [];
	for (const question of result.questions) {
		const listed = question.services.map(name => byName.get(name)).filter(service => service !== undefined);
		if (question.kind === 'domain') {
			const service = listed.find(s => s.publicDomain);
			if (service && !questions.some(q => q.kind === 'domain' && q.serviceIds.includes(service._id))) {
				questions.push({
					_id: crypto.randomUUID(),
					kind: 'domain',
					title: question.title,
					description: question.description,
					serviceIds: [service._id],
					envKeys: []
				});
			}
			continue;
		}
		const envKeys = question.envKeys.filter(key => listed.some(service => service.env.some(entry => entry.key === key && !isReference(entry))));
		if (envKeys.length) {
			questions.push({
				_id: crypto.randomUUID(),
				kind: 'values',
				title: question.title,
				description: question.description,
				serviceIds: listed.map(s => s._id),
				envKeys
			});
		}
	}

	// Safety net: every public service gets a domain question and every value the user must supply is asked somewhere, even if the model forgot.
	for (const service of services) {
		if (service.publicDomain && !questions.some(q => q.kind === 'domain' && q.serviceIds.includes(service._id))) {
			questions.unshift({
				_id: crypto.randomUUID(),
				kind: 'domain',
				title: `Domain for ${service.name}`,
				description: null,
				serviceIds: [service._id],
				envKeys: []
			});
		}
		const asked = new Set(questions.filter(q => q.kind === 'values' && q.serviceIds.includes(service._id)).flatMap(q => q.envKeys));
		const open = service.env.filter(entry => needsValue(entry) && !asked.has(entry.key)).map(entry => entry.key);
		if (open.length) {
			questions.push({
				_id: crypto.randomUUID(),
				kind: 'values',
				title: `Other values for ${service.name}`,
				description: null,
				serviceIds: [service._id],
				envKeys: open
			});
		}
	}

	for (const question of questions.filter(q => q.kind === 'values')) {
		answers[question._id] = Object.fromEntries(
			question.envKeys.map(key => {
				const entry = services
					.filter(s => question.serviceIds.includes(s._id))
					.flatMap(s => s.env)
					.find(e => e.key === key);
				return [key, entry?.value ?? ''];
			})
		);
	}

	return { services, databases, questions, warnings: result.warnings, defaultDomainBase: result.defaultDomainBase };
}

async function runAnalysis() {
	if (!source.value) return;
	rootError.value = null;
	try {
		const result = await analyze.mutateAsync(source.value);
		analyzedSource.value = source.value;
		plan.value = toDraft(result);
		if (result.services.length === 0) {
			rootError.value = 'No deployable services were found in this repository.';
			return;
		}
		step.value = plan.value.questions.length ? 'questions' : 'review';
	} catch (err) {
		rootError.value = planError(err, 'Analysis failed.');
	}
}

const serviceById = computed(() => new Map((plan.value?.services ?? []).map(service => [service._id, service])));

function questionServices(question: DraftQuestion): DraftService[] {
	return question.serviceIds.map(id => serviceById.value.get(id)).filter(service => service !== undefined);
}

function isSecretKey(question: DraftQuestion, key: string): boolean {
	return questionServices(question).some(service => service.env.some(entry => entry.key === key && entry.secret));
}

function noteFor(question: DraftQuestion, key: string): string | null {
	for (const service of questionServices(question)) {
		const note = service.env.find(entry => entry.key === key)?.note;
		if (note) return note;
	}
	return null;
}

function applyAnswers() {
	for (const question of plan.value?.questions ?? []) {
		if (question.kind !== 'values') continue;
		for (const [key, value] of Object.entries(answers[question._id] ?? {})) {
			for (const service of questionServices(question)) {
				const entry = service.env.find(e => e.key === key);
				if (entry && !isReference(entry)) entry.value = value;
			}
		}
	}
	step.value = 'review';
}

const includedServices = computed(() => plan.value?.services.filter(service => service.include) ?? []);

function isDatabaseType(type: string) {
	return type === 'postgres' || type === 'mysql' || type === 'mariadb' || type === 'mongodb';
}

function targetOptions(entry: DraftEnv, self: DraftService) {
	const p = plan.value;
	if (!p) return [];
	const existing = existingServices.value ?? [];
	const kind = entry.kind;
	if (kind === 'env') {
		return p.services
			.filter(s => s.include && s._id !== self._id && s.env.some(e => e.key === entry.refKey && !isReference(e)))
			.map(s => ({ value: `svc:${s._id}`, label: `${s.name || 'unnamed'} (${entry.refKey})` }));
	}
	if (kind === 'connectionUri') {
		return [
			...p.databases.map(d => ({ value: `db:${d._id}`, label: `${d.name || 'unnamed'} (new ${d.engine})` })),
			...existing.filter(s => isDatabaseType(s.type)).map(s => ({ value: `existing:${s.name}`, label: `${s.name} (existing)` }))
		];
	}
	if (kind === 'publicUrl') {
		return [
			...p.services.filter(s => s.include && s.publicDomain).map(s => ({ value: `svc:${s._id}`, label: `${s.name || 'unnamed'} (new)` })),
			...existing.filter(s => s.defaultUrl || s.config.domains.length).map(s => ({ value: `existing:${s.name}`, label: `${s.name} (existing)` }))
		];
	}
	return [
		...p.services.filter(s => s.include && s._id !== self._id).map(s => ({ value: `svc:${s._id}`, label: `${s.name || 'unnamed'} (new)` })),
		...existing
			.filter(s => !isDatabaseType(s.type) && s.config.containerPort != null)
			.map(s => ({ value: `existing:${s.name}`, label: `${s.name} (existing)` }))
	];
}

// A new database is only created while an included service still references it.
const usedDatabases = computed(() => {
	const used = new Set(includedServices.value.flatMap(service => service.env.map(entry => entry.target)));
	return (plan.value?.databases ?? []).filter(database => used.has(`db:${database._id}`));
});

function databaseUsers(database: DraftDatabase) {
	return includedServices.value.filter(service => service.env.some(entry => entry.target === `db:${database._id}`)).map(service => service.name);
}

function missingCount(service: DraftService): number {
	return service.env.filter(needsValue).length;
}

const totalMissing = computed(() => includedServices.value.reduce((sum, service) => sum + missingCount(service), 0));

function domainLabel(service: DraftService): string {
	if (!service.publicDomain) return 'internal';
	if (service.domain.trim()) return service.domain.trim();
	return plan.value?.defaultDomainBase ? 'generated domain' : 'no domain';
}

function targetName(target: string): string {
	const [kind, ref] = [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)];
	if (kind === 'existing') return ref;
	if (kind === 'db') return plan.value?.databases.find(d => d._id === ref)?.name.trim() ?? '';
	return plan.value?.services.find(s => s._id === ref)?.name.trim() ?? '';
}

function addEnv(service: DraftService) {
	service.env.push({
		_id: crypto.randomUUID(),
		key: '',
		value: '',
		secret: false,
		generate: false,
		kind: null,
		target: LITERAL,
		refKey: null,
		note: null
	});
}

const pasteFor = ref<string | null>(null);
const pasteText = ref('');

function applyPaste(service: DraftService) {
	for (const { key, value } of parseDotenv(pasteText.value)) {
		const entry = service.env.find(e => e.key === key);
		if (entry) {
			entry.value = value;
			entry.target = LITERAL;
		} else {
			service.env.push({
				_id: crypto.randomUUID(),
				key,
				value,
				secret: SECRET_KEY_RE.test(key),
				generate: false,
				kind: null,
				target: LITERAL,
				refKey: null,
				note: null
			});
		}
	}
	pasteText.value = '';
	pasteFor.value = null;
}

function envPayload(service: DraftService) {
	return service.env
		.filter(entry => entry.key.trim())
		.map(entry => ({
			key: entry.key.trim(),
			value: isReference(entry) || entry.value === '' ? null : entry.value,
			secret: entry.secret,
			generate: entry.generate,
			reference:
				isReference(entry) && entry.kind
					? { service: targetName(entry.target), kind: entry.kind, key: entry.kind === 'env' ? entry.refKey : null }
					: null
		}));
}

function portOf(service: DraftService): number | null {
	const port = Number.parseInt(service.containerPort, 10);
	return Number.isInteger(port) ? port : null;
}

function domainOf(service: DraftService): string | null {
	return service.publicDomain && service.domain.trim() ? service.domain.trim() : null;
}

async function createAll() {
	const p = plan.value;
	if (!p || !analyzedSource.value || includedServices.value.length === 0) return;
	rootError.value = null;
	try {
		const created = await createFromPlan.mutateAsync({
			source: analyzedSource.value,
			autoDeploy: autoDeploy.value,
			images: includedServices.value
				.filter(service => service.kind === 'image')
				.map(image => ({
					name: image.name.trim(),
					image: image.image.trim(),
					tag: image.tag.trim(),
					containerPort: portOf(image),
					args: image.args
						.split('\n')
						.map(arg => arg.trim())
						.filter(Boolean),
					volumes: image.volumes.map(volume => ({ name: volume.name.trim(), mountPath: volume.mountPath.trim(), size: volume.size.trim() })),
					publicDomain: image.publicDomain,
					domain: domainOf(image),
					env: envPayload(image)
				})),
			services: includedServices.value
				.filter(service => service.kind === 'app')
				.map(service => {
					return {
						name: service.name.trim(),
						rootDirectory: service.rootDirectory.trim(),
						builder: service.builder,
						dockerfilePath: service.builder === 'dockerfile' ? service.dockerfilePath.trim() || null : null,
						buildCommand: service.builder === 'nixpacks' ? service.buildCommand.trim() || null : null,
						startCommand: service.builder === 'nixpacks' ? service.startCommand.trim() || null : null,
						containerPort: portOf(service),
						watchPaths: parseWatchPathsTextarea(service.watchPaths),
						publicDomain: service.publicDomain,
						domain: domainOf(service),
						env: envPayload(service)
					};
				}),
			databases: usedDatabases.value.map(database => ({ name: database.name.trim(), engine: database.engine }))
		});
		toast.success(`${created.length} ${created.length === 1 ? 'service' : 'services'} created`);
		emit('created', created);
		emit('done');
	} catch (err) {
		rootError.value = planError(err, 'Could not create the services.');
	}
}

function changeSource() {
	plan.value = null;
	step.value = 'source';
	rootError.value = null;
}
</script>

<template>
	<div v-if="step === 'source'" class="flex min-w-0 flex-col gap-4">
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5">
				<Label>Source</Label>
				<Select v-model="sourceType" :disabled="analyze.isPending.value">
					<SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
					<SelectContent>
						<SelectItem value="github-repo">GitHub repository</SelectItem>
						<SelectItem value="gitea-repo">Gitea repository</SelectItem>
						<SelectItem value="private-repo">Private repository (SSH)</SelectItem>
						<SelectItem value="public-repo">Public repository</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="analyze-branch">Branch</Label>
				<Input id="analyze-branch" v-model="branch" placeholder="main" class="font-mono text-xs" :disabled="analyze.isPending.value" />
			</div>
		</div>

		<div v-if="sourceType === 'github-repo' || sourceType === 'gitea-repo'" class="grid gap-4 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5">
				<Label>Account</Label>
				<Select v-model="installationId" :disabled="analyze.isPending.value">
					<SelectTrigger class="w-full"><SelectValue placeholder="Select an account" /></SelectTrigger>
					<SelectContent>
						<SelectItem v-for="inst in installations" :key="inst.id" :value="inst.id">{{ inst.accountLogin }}</SelectItem>
					</SelectContent>
				</Select>
				<span v-if="installations.length === 0" class="text-xs text-muted-foreground">
					No connected accounts. Connect one in <NuxtLink to="/team/settings" class="underline">team settings</NuxtLink>.
				</span>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label>Repository</Label>
				<Select v-model="repoFullName" :disabled="analyze.isPending.value || !installationId">
					<SelectTrigger class="w-full"><SelectValue placeholder="Select a repository" /></SelectTrigger>
					<SelectContent>
						<SelectItem v-for="repo in repos" :key="repo.repoFullName" :value="repo.repoFullName">{{ repo.repoFullName }}</SelectItem>
					</SelectContent>
				</Select>
			</div>
		</div>

		<div v-else class="grid gap-4" :class="sourceType === 'private-repo' && 'sm:grid-cols-2'">
			<div class="flex flex-col gap-1.5">
				<Label for="analyze-url">Repository URL</Label>
				<Input
					id="analyze-url"
					v-model="repoUrl"
					:placeholder="sourceType === 'private-repo' ? 'git@github.com:org/repo.git' : 'https://github.com/org/repo.git'"
					class="font-mono text-xs"
					:disabled="analyze.isPending.value"
				/>
			</div>
			<div v-if="sourceType === 'private-repo'" class="flex flex-col gap-1.5">
				<Label>Deploy key</Label>
				<Select v-model="sshKeyId" :disabled="analyze.isPending.value">
					<SelectTrigger class="w-full"><SelectValue placeholder="Select a deploy key" /></SelectTrigger>
					<SelectContent>
						<SelectItem v-for="key in sshKeys ?? []" :key="key.id" :value="key.id">{{ key.name }} · {{ key.keyType }}</SelectItem>
					</SelectContent>
				</Select>
			</div>
		</div>

		<p class="text-xs text-muted-foreground">
			The configured model reads the file tree, manifests, Dockerfiles, and env templates — never real .env files. Nothing is created until you review
			the proposal.
		</p>

		<p v-if="rootError" class="text-sm text-destructive">{{ rootError }}</p>

		<div class="flex items-center justify-between gap-2 pt-2">
			<Button type="button" variant="ghost" :disabled="analyze.isPending.value" @click="emit('back')">
				<ArrowLeft />
				Back
			</Button>
			<Button type="button" :disabled="!source || analyze.isPending.value" @click="runAnalysis">
				<Loader2 v-if="analyze.isPending.value" class="animate-spin" />
				<Sparkles v-else />
				{{ analyze.isPending.value ? 'Analyzing… this can take a minute' : 'Analyze repository' }}
			</Button>
		</div>
	</div>

	<div v-else-if="plan && step === 'questions'" class="flex min-w-0 flex-col gap-4">
		<p class="text-sm text-muted-foreground">A few details only you know. Anything you leave empty can be filled in later in the service settings.</p>

		<div class="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
			<div v-for="question in plan.questions" :key="question._id" class="flex flex-col gap-2 rounded-lg border p-3">
				<div class="flex items-start gap-2">
					<component :is="question.kind === 'domain' ? Globe : KeyRound" class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
					<div class="flex flex-col gap-0.5">
						<span class="text-sm font-medium">{{ question.title }}</span>
						<span v-if="question.description" class="text-xs text-muted-foreground">{{ question.description }}</span>
						<span v-if="question.kind === 'values' && question.serviceIds.length > 1" class="text-xs text-muted-foreground">
							Used by
							{{
								questionServices(question)
									.map(s => s.name)
									.join(', ')
							}}
						</span>
					</div>
				</div>

				<template v-if="question.kind === 'domain'">
					<Input
						v-for="service in questionServices(question)"
						:key="service._id"
						v-model="service.domain"
						:placeholder="plan.defaultDomainBase ? `Leave empty for ${service.name}-xxxxxxxx.${plan.defaultDomainBase}` : 'app.example.com'"
						class="h-8 font-mono text-xs"
					/>
					<span v-if="!plan.defaultDomainBase" class="text-xs text-amber-600 dark:text-amber-400">
						This cluster has no generated domains yet, so enter a domain you point at the cluster ingress.
					</span>
				</template>

				<div v-else class="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-center">
					<template v-for="key in question.envKeys" :key="key">
						<label :for="`${question._id}-${key}`" class="truncate font-mono text-xs" :title="noteFor(question, key) ?? key">{{ key }}</label>
						<Input
							:id="`${question._id}-${key}`"
							v-model="answers[question._id]![key]"
							:type="isSecretKey(question, key) ? 'password' : 'text'"
							autocomplete="new-password"
							:placeholder="noteFor(question, key) ?? ''"
							class="h-8 font-mono text-xs"
						/>
					</template>
				</div>
			</div>
		</div>

		<div class="flex items-center justify-between gap-2 pt-2">
			<Button type="button" variant="ghost" @click="changeSource">
				<ArrowLeft />
				Change source
			</Button>
			<Button type="button" @click="applyAnswers">
				Show plan
				<ArrowRight />
			</Button>
		</div>
	</div>

	<div v-else-if="plan" class="flex min-w-0 flex-col gap-4">
		<div class="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
			<details v-if="plan.warnings.length" class="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
				<summary class="flex cursor-pointer items-center gap-1.5 font-medium">
					<AlertTriangle class="size-3.5 text-amber-500" />
					{{ plan.warnings.length }} {{ plan.warnings.length === 1 ? 'note' : 'notes' }} from the analysis
				</summary>
				<ul class="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
					<li v-for="(warning, i) in plan.warnings" :key="i">{{ warning }}</li>
				</ul>
			</details>

			<div v-for="service in plan.services" :key="service._id" class="rounded-lg border" :class="!service.include && 'opacity-60'">
				<div class="flex items-center gap-3 px-3 py-2">
					<Checkbox v-model="service.include" :aria-label="`Create ${service.name}`" />
					<button
						type="button"
						class="flex min-w-0 flex-1 flex-col text-left"
						:disabled="!service.include"
						@click="service.expanded = !service.expanded"
					>
						<span class="flex flex-wrap items-center gap-1.5">
							<span class="text-sm font-medium">{{ service.name }}</span>
							<Badge v-if="service.kind === 'image'" variant="secondary" class="gap-1 font-mono font-normal">
								<Box class="size-3" />{{ service.image }}:{{ service.tag }}
							</Badge>
							<Badge v-else variant="secondary" class="font-normal">{{ service.builder === 'dockerfile' ? 'Dockerfile' : 'Nixpacks' }}</Badge>
							<Badge v-if="service.containerPort" variant="secondary" class="font-mono font-normal">:{{ service.containerPort }}</Badge>
							<Badge variant="outline" class="gap-1 font-normal"><Globe class="size-3" />{{ domainLabel(service) }}</Badge>
						</span>
						<span class="truncate text-xs text-muted-foreground" :title="service.reason">{{ service.reason }}</span>
					</button>
					<span class="shrink-0 text-xs text-muted-foreground">
						{{ service.env.length }} env
						<span v-if="missingCount(service)" class="text-amber-600 dark:text-amber-400">· {{ missingCount(service) }} empty</span>
					</span>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="size-7 shrink-0"
						:disabled="!service.include"
						:aria-label="service.expanded ? 'Collapse' : 'Edit'"
						@click="service.expanded = !service.expanded"
					>
						<ChevronDown class="size-4 transition-transform" :class="service.expanded && 'rotate-180'" />
					</Button>
				</div>

				<div v-if="service.include && service.expanded" class="flex flex-col gap-3 border-t px-3 py-3">
					<div class="grid gap-3 sm:grid-cols-3">
						<div class="flex flex-col gap-1">
							<Label class="text-xs">Name</Label>
							<Input v-model="service.name" class="h-8 text-xs" />
						</div>
						<template v-if="service.kind === 'image'">
							<div class="flex flex-col gap-1">
								<Label class="text-xs">Image</Label>
								<Input v-model="service.image" placeholder="minio/minio" class="h-8 font-mono text-xs" />
							</div>
							<div class="flex flex-col gap-1">
								<Label class="text-xs">Tag</Label>
								<Input v-model="service.tag" class="h-8 font-mono text-xs" />
							</div>
						</template>
						<div v-else class="flex flex-col gap-1">
							<Label class="text-xs">Build method</Label>
							<Select v-model="service.builder">
								<SelectTrigger class="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
								<SelectContent>
									<SelectItem value="nixpacks">Nixpacks</SelectItem>
									<SelectItem value="dockerfile">Dockerfile</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div class="flex flex-col gap-1">
							<Label class="text-xs">Port</Label>
							<Input v-model="service.containerPort" placeholder="none" inputmode="numeric" class="h-8 font-mono text-xs" />
						</div>
						<template v-if="service.kind === 'image'">
							<div class="flex flex-col gap-1 sm:col-span-2">
								<Label class="text-xs">Arguments</Label>
								<Textarea v-model="service.args" placeholder="server&#10;/data" class="min-h-16 font-mono text-xs" />
								<span class="text-[11px] text-muted-foreground">Passed to the image entrypoint, one per line.</span>
							</div>
							<div class="flex flex-col gap-1.5 sm:col-span-3">
								<Label class="text-xs">Volumes</Label>
								<span v-if="!service.volumes.length" class="text-xs text-muted-foreground">No persistent storage.</span>
								<div v-for="(volume, index) in service.volumes" :key="volume._id" class="flex items-center gap-2">
									<Input v-model="volume.name" placeholder="data" class="h-7 w-1/4 font-mono text-xs" />
									<Input v-model="volume.mountPath" placeholder="/data" class="h-7 flex-1 font-mono text-xs" />
									<Input v-model="volume.size" placeholder="5Gi" class="h-7 w-20 font-mono text-xs" />
									<button
										type="button"
										class="shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:text-destructive"
										aria-label="Remove volume"
										@click="service.volumes.splice(index, 1)"
									>
										<X class="size-3.5" />
									</button>
								</div>
							</div>
						</template>
						<template v-else>
							<div class="flex flex-col gap-1">
								<Label class="text-xs">Root directory</Label>
								<Input v-model="service.rootDirectory" placeholder="(repo root)" class="h-8 font-mono text-xs" />
							</div>
							<div v-if="service.builder === 'dockerfile'" class="flex flex-col gap-1 sm:col-span-2">
								<Label class="text-xs">Dockerfile path</Label>
								<Input v-model="service.dockerfilePath" placeholder="Dockerfile" class="h-8 font-mono text-xs" />
							</div>
							<template v-else>
								<div class="flex flex-col gap-1">
									<Label class="text-xs">Build command</Label>
									<Input v-model="service.buildCommand" placeholder="auto" class="h-8 font-mono text-xs" />
								</div>
								<div class="flex flex-col gap-1">
									<Label class="text-xs">Start command</Label>
									<Input v-model="service.startCommand" placeholder="auto" class="h-8 font-mono text-xs" />
								</div>
							</template>
							<div class="flex flex-col gap-1 sm:col-span-3">
								<Label class="text-xs">Watch paths</Label>
								<Textarea v-model="service.watchPaths" placeholder="packages/shared" class="min-h-16 font-mono text-xs" />
								<span class="text-[11px] text-muted-foreground">One repo-relative path per line.</span>
							</div>
						</template>
						<div class="flex items-center gap-3 sm:col-span-3">
							<label class="flex shrink-0 items-center gap-2 text-xs">
								<Switch v-model="service.publicDomain" />
								Public
							</label>
							<Input
								v-if="service.publicDomain"
								v-model="service.domain"
								:placeholder="plan.defaultDomainBase ? `Domain — leave empty for a generated ${plan.defaultDomainBase} domain` : 'app.example.com'"
								class="h-8 flex-1 font-mono text-xs"
							/>
						</div>
					</div>

					<div class="flex flex-col gap-1.5">
						<div class="flex items-center justify-between">
							<span class="text-xs font-medium">Environment</span>
							<div class="flex gap-1">
								<Button type="button" variant="ghost" size="sm" class="h-7 text-xs" @click="pasteFor = pasteFor === service._id ? null : service._id">
									<ClipboardPaste class="size-3.5" />
									Paste .env
								</Button>
								<Button type="button" variant="ghost" size="sm" class="h-7 text-xs" @click="addEnv(service)">
									<Plus class="size-3.5" />
									Add
								</Button>
							</div>
						</div>
						<div v-if="pasteFor === service._id" class="flex flex-col gap-2 rounded-md border bg-muted/20 p-2">
							<Textarea v-model="pasteText" placeholder="KEY=value" class="min-h-24 font-mono text-xs" />
							<Button type="button" size="sm" class="self-end" :disabled="!pasteText.trim()" @click="applyPaste(service)">Fill values</Button>
						</div>
						<div v-for="(entry, index) in service.env" :key="entry._id" class="flex items-center gap-2">
							<Input v-model="entry.key" placeholder="KEY" class="h-7 w-2/5 shrink-0 font-mono text-xs" :title="entry.note ?? undefined" />
							<Select v-if="entry.kind" v-model="entry.target">
								<SelectTrigger class="h-7 min-w-0 flex-1 text-xs"><SelectValue placeholder="Enter a value instead" /></SelectTrigger>
								<SelectContent>
									<SelectItem v-for="option in targetOptions(entry, service)" :key="option.value" :value="option.value">
										{{ REFERENCE_LABEL[entry.kind] }} {{ option.label }}
									</SelectItem>
									<SelectItem :value="LITERAL">Enter a value instead</SelectItem>
								</SelectContent>
							</Select>
							<Input
								v-if="!isReference(entry)"
								v-model="entry.value"
								:type="entry.secret ? 'password' : 'text'"
								autocomplete="new-password"
								:placeholder="entry.generate ? 'generated automatically' : (entry.note ?? (entry.secret ? 'secret value' : 'value'))"
								:title="entry.note ?? undefined"
								class="h-7 min-w-0 flex-1 font-mono text-xs"
								:class="needsValue(entry) && 'border-amber-500/60'"
							/>
							<button
								type="button"
								class="shrink-0 rounded p-1 transition-colors"
								:class="entry.secret ? 'text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'"
								:disabled="isReference(entry) && entry.kind === 'connectionUri'"
								:aria-label="entry.secret ? 'Stored as secret' : 'Store as secret'"
								:title="entry.secret ? 'Stored as secret' : 'Store as secret'"
								@click="entry.secret = !entry.secret"
							>
								<KeyRound class="size-3.5" />
							</button>
							<button
								type="button"
								class="shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:text-destructive"
								aria-label="Remove"
								@click="service.env.splice(index, 1)"
							>
								<X class="size-3.5" />
							</button>
						</div>
					</div>
				</div>
			</div>

			<div v-if="plan.databases.length" class="flex flex-col gap-1.5 rounded-lg border px-3 py-2">
				<span class="flex items-center gap-1.5 text-xs font-medium"><Database class="size-3.5" /> New databases</span>
				<div v-for="database in plan.databases" :key="database._id" class="flex items-center gap-2">
					<Input v-model="database.name" class="h-7 w-1/3 font-mono text-xs" />
					<Badge variant="secondary" class="font-normal">{{ database.engine }}</Badge>
					<span class="text-xs text-muted-foreground">
						{{ databaseUsers(database).length ? `used by ${databaseUsers(database).join(', ')}` : 'not referenced — will not be created' }}
					</span>
				</div>
			</div>
		</div>

		<label class="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
			<span class="flex flex-col">
				<span class="text-sm font-medium">Auto-deploy on push</span>
				<span class="text-xs text-muted-foreground">Redeploy a service when a commit touches its root directory or watch paths.</span>
			</span>
			<Switch v-model="autoDeploy" />
		</label>

		<p v-if="totalMissing" class="text-xs text-amber-600 dark:text-amber-400">
			{{ totalMissing }} {{ totalMissing === 1 ? 'variable is' : 'variables are' }} still empty and will be skipped. Add them later in the service
			settings.
		</p>
		<p v-if="rootError" class="text-sm text-destructive">{{ rootError }}</p>

		<div class="flex items-center justify-between gap-2 pt-2">
			<Button
				type="button"
				variant="ghost"
				:disabled="createFromPlan.isPending.value"
				@click="plan.questions.length ? (step = 'questions') : changeSource()"
			>
				<ArrowLeft />
				Back
			</Button>
			<Button type="button" :disabled="createFromPlan.isPending.value || includedServices.length === 0" @click="createAll">
				{{
					createFromPlan.isPending.value
						? 'Creating…'
						: `Create ${includedServices.length + usedDatabases.length} ${includedServices.length + usedDatabases.length === 1 ? 'service' : 'services'}`
				}}
			</Button>
		</div>
	</div>
</template>
