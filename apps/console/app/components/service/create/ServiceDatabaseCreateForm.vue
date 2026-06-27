<script setup lang="ts">
import * as z from 'zod';
import { ArrowLeft, ChevronDown } from 'lucide-vue-next';
import type { Service } from '~/utils/types';
import { DATABASE_ENGINE_UI, type DatabaseEngine } from '~/utils/database-engines';

// One form for all four managed-database engines, parametrized by `engine` (the service type).
const props = defineProps<{ environmentId: string; engine: DatabaseEngine }>();
const emit = defineEmits<{ created: [Service]; back: []; done: [] }>();

const ui = computed(() => DATABASE_ENGINE_UI[props.engine]);

const identifier = z
	.string()
	.trim()
	.regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use letters, digits, and underscores; start with a letter.')
	.or(z.literal(''));
const quantity = z
	.string()
	.trim()
	.regex(/^\d+(\.\d+)?[EPTGMK]i?$/, 'Enter a quantity like 1Gi.')
	.or(z.literal(''));

const schema = z.object({
	name: z.string().trim().min(1, 'Enter a service name.'),
	version: z.string().min(1, 'Pick a version.'),
	database: identifier,
	username: identifier,
	storage: quantity,
	description: z.string().optional()
});

const advancedOpen = ref(false);
const rootError = ref<string | null>(null);

const toast = useToast();
const createService = useCreateService(() => props.environmentId);

const { form, isSubmitting } = useAppForm({
	schema,
	defaultValues: {
		name: '',
		version: ui.value.defaultVersion,
		database: '',
		username: '',
		storage: '1Gi',
		description: ''
	},
	onSubmit: async ({ value }) => {
		rootError.value = null;
		try {
			const config = {
				version: value.version,
				storage: { size: value.storage?.trim() || '1Gi' },
				...(value.database?.trim() ? { database: value.database.trim() } : {}),
				...(value.username?.trim() ? { username: value.username.trim() } : {})
			};
			// `type` is a runtime engine value; all four engine branches share this config shape.
			const service = await createService.mutateAsync({ name: value.name, description: value.description ?? '', type: props.engine, config });
			emit('created', service);
			toast.success(`${ui.value.label} created`);
			emit('done');
		} catch (err) {
			rootError.value = serviceErrorMessage(err, 'Could not create database.');
		}
	}
});
</script>

<template>
	<AppForm :form="form" class="flex flex-col gap-4">
		<div class="grid gap-4 sm:grid-cols-5">
			<Field v-slot="{ componentField }" name="name" label="Name" class="sm:col-span-3">
				<Input v-bind="componentField" autofocus placeholder="db" :disabled="isSubmitting" />
			</Field>
			<Field v-slot="{ componentField }" name="version" label="Version" class="sm:col-span-2">
				<Select v-bind="componentField" :disabled="isSubmitting">
					<SelectTrigger class="w-full">
						<SelectValue placeholder="Pick a version" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem v-for="v in ui.versions" :key="v" :value="v">{{ v }}</SelectItem>
					</SelectContent>
				</Select>
			</Field>
		</div>

		<Collapsible v-model:open="advancedOpen" class="flex flex-col gap-2">
			<CollapsibleTrigger as-child>
				<Button type="button" variant="link" size="sm" class="-ml-1 self-start text-muted-foreground">
					Advanced
					<ChevronDown class="size-3.5 transition-transform" :class="advancedOpen && 'rotate-180'" />
				</Button>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div class="grid gap-4 pt-1 sm:grid-cols-3">
					<Field v-slot="{ componentField }" name="database" label="Database name">
						<Input v-bind="componentField" placeholder="app" :disabled="isSubmitting" />
					</Field>
					<Field v-slot="{ componentField }" name="username" label="Username">
						<Input v-bind="componentField" placeholder="app" :disabled="isSubmitting" />
					</Field>
					<Field v-slot="{ componentField }" name="storage" label="Storage">
						<Input v-bind="componentField" placeholder="1Gi" :disabled="isSubmitting" />
					</Field>
				</div>
				<p class="pt-2 text-xs text-muted-foreground">
					Defaults to user <code class="font-mono">app</code>, database <code class="font-mono">app</code>, and 1Gi of storage. A strong password is
					generated automatically — find the connection details in the service settings.
				</p>
			</CollapsibleContent>
		</Collapsible>

		<Field v-slot="{ componentField }" name="description" label="Description">
			<Input v-bind="componentField" placeholder="Primary database" :disabled="isSubmitting" />
		</Field>

		<p v-if="rootError" class="text-sm text-destructive">{{ rootError }}</p>

		<div class="flex items-center justify-between gap-2 pt-2">
			<Button type="button" variant="ghost" :disabled="isSubmitting" @click="emit('back')">
				<ArrowLeft />
				Back
			</Button>
			<Button type="submit" :disabled="isSubmitting">{{ isSubmitting ? 'Creating…' : 'Create database' }}</Button>
		</div>
	</AppForm>
</template>
