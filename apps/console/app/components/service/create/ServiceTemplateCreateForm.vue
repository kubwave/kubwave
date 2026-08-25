<script setup lang="ts">
import * as z from 'zod';
import { ArrowLeft, Copy } from 'lucide-vue-next';
import type { GeneratedTemplateSecretDto } from '@kubwave/api-client';
import type { Service } from '~/utils/types';
import type { TemplateListItem } from '~/composables/use-templates';

const props = defineProps<{ environmentId: string; template: TemplateListItem }>();
const emit = defineEmits<{ created: [Service[]]; back: []; done: []; reviewingSecrets: [] }>();

// Name + one field per declared template input. All inputs are strings in the MVP.
const schemaShape: Record<string, z.ZodTypeAny> = {
	name: z.string().trim().min(1, 'Enter a name.')
};
for (const input of props.template.inputs) {
	schemaShape[input.key] = input.required ? z.string().trim().min(1, `${input.label} is required.`) : z.string().trim().optional().default('');
}

const initialValues: Record<string, string> = { name: props.template.id };
for (const input of props.template.inputs) initialValues[input.key] = input.default ?? '';

const rootError = ref<string | null>(null);
const generatedSecrets = ref<GeneratedTemplateSecretDto[] | null>(null);
const api = useApi();
const toast = useToast();

function createError(err: unknown): string {
	if (errorCode(err) === 'template_input_required') return 'Please fill in all required fields.';
	return serviceErrorMessage(err, 'Could not create from template.');
}

async function copy(value: string, label: string) {
	try {
		await navigator.clipboard.writeText(value);
		toast.success(`${label} copied`);
	} catch {
		toast.error('Could not copy to clipboard');
	}
}

const { form, isSubmitting } = useAppForm({
	schema: z.object(schemaShape),
	defaultValues: initialValues,
	onSubmit: async ({ value }) => {
		rootError.value = null;
		try {
			const inputs: Record<string, string> = {};
			for (const input of props.template.inputs) inputs[input.key] = (value[input.key] as string) ?? '';
			const result = await apiData(
				api.environments(props.environmentId).services.fromTemplate.post({
					templateId: props.template.id,
					name: value.name as string,
					inputs
				})
			).catch(err => {
				rootError.value = createError(err);
				return null;
			});
			if (!result) return;
			emit('created', result.services);
			toast.success('Service created');
			if (result.generatedSecrets.length === 0) {
				emit('done');
				return;
			}
			generatedSecrets.value = result.generatedSecrets;
			emit('reviewingSecrets');
		} catch {
			rootError.value = 'Could not reach the server.';
		}
	}
});
</script>

<template>
	<div v-if="generatedSecrets" class="flex flex-col gap-4">
		<div class="flex max-h-[40vh] flex-col gap-3 overflow-y-auto pr-0.5">
			<div v-for="secret in generatedSecrets" :key="secret.key" class="flex flex-col gap-1.5">
				<label :for="`generated-secret-${secret.key}`" class="font-mono text-xs text-muted-foreground">{{ secret.key }}</label>
				<div class="relative">
					<Input
						:id="`generated-secret-${secret.key}`"
						:model-value="secret.value"
						readonly
						autocomplete="off"
						spellcheck="false"
						class="pr-10 font-mono text-xs"
					/>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						class="absolute top-1/2 right-1 size-7 -translate-y-1/2"
						:aria-label="`Copy ${secret.key}`"
						@click="copy(secret.value, secret.key)"
					>
						<Copy class="size-3.5" />
					</Button>
				</div>
			</div>
		</div>

		<div class="flex items-center justify-end pt-2">
			<Button type="button" @click="emit('done')">Continue</Button>
		</div>
	</div>

	<AppForm v-else :form="form" class="flex flex-col gap-4">
		<Field v-slot="{ componentField }" name="name" label="Name">
			<Input v-bind="componentField" autofocus :disabled="isSubmitting" />
		</Field>

		<Field v-for="input in template.inputs" :key="input.key" v-slot="{ componentField }" :name="input.key" :label="input.label">
			<Input v-bind="componentField" :placeholder="input.placeholder" :disabled="isSubmitting" />
		</Field>

		<p v-if="rootError" class="text-sm text-destructive">{{ rootError }}</p>

		<div class="flex items-center justify-between gap-2 pt-2">
			<Button type="button" variant="ghost" :disabled="isSubmitting" @click="emit('back')">
				<ArrowLeft />
				Back
			</Button>
			<Button type="submit" :disabled="isSubmitting">{{ isSubmitting ? 'Creating…' : 'Create service' }}</Button>
		</div>
	</AppForm>
</template>
