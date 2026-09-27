<script setup lang="ts">
import { ClipboardPaste, Eye, EyeOff, KeyRound, Plus, X } from 'lucide-vue-next';
import type { Service } from '~/utils/types';
import type { ServiceSettingsValues } from '~/composables/use-service-settings-schema';

const props = defineProps<{
	state: ServiceSettingsValues;
	saving: boolean;
	service: Service;
	shownSecrets: Record<string, boolean>;
	addEnv: () => void;
	removeEnv: (index: number) => void;
	addSecret: () => void;
	removeSecret: (index: number) => void;
	toggleSecret: (id: string) => void;
	importDotenv: (entries: Array<{ key: string; value: string }>, asSecrets: boolean) => void;
}>();

// Strings, not template text: Vue would treat the `{{ }}` as interpolation.
const referenceTrigger = '${{';
const referenceExample = '${{services.<name>.url}}';

const { data: environmentServices } = useEnvironmentServices(() => props.service.environmentId);
const serviceNames = computed(() => (environmentServices.value ?? []).map(s => s.name));

const pasteOpen = ref(false);
const pasteText = ref('');
const parsedPaste = computed(() => parseDotenv(pasteText.value));

function applyPaste(asSecrets: boolean) {
	props.importDotenv(parsedPaste.value, asSecrets);
	pasteText.value = '';
	pasteOpen.value = false;
}
</script>

<template>
	<div class="flex flex-col gap-6">
		<!-- Environment variables -->
		<section class="flex flex-col gap-3">
			<div class="flex items-start justify-between gap-2">
				<div>
					<h3 class="text-sm font-medium">Environment variables</h3>
					<p class="text-xs text-muted-foreground">Injected into the container at runtime.</p>
					<p class="text-xs text-muted-foreground">
						Type <code class="font-mono">{{ referenceTrigger }}</code> to reference a service in this environment, e.g.
						<code class="font-mono">{{ referenceExample }}</code
						>. Resolved on every deploy, also in secrets and config files.
					</p>
				</div>
				<div class="flex items-center gap-1">
					<Button type="button" variant="ghost" size="sm" :disabled="saving" @click="pasteOpen = !pasteOpen">
						<ClipboardPaste />
						Paste .env
					</Button>
					<Button type="button" variant="ghost" size="sm" @click="addEnv">
						<Plus />
						Add
					</Button>
				</div>
			</div>
			<div v-if="pasteOpen" class="flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
				<Textarea v-model="pasteText" placeholder="DATABASE_URL=postgres://…&#10;API_KEY=…" class="min-h-28 font-mono text-xs" :disabled="saving" />
				<div class="flex flex-wrap items-center justify-between gap-2">
					<span class="text-xs text-muted-foreground">
						{{ parsedPaste.length }} {{ parsedPaste.length === 1 ? 'variable' : 'variables' }} found. Existing keys are overwritten.
					</span>
					<div class="flex gap-2">
						<Button type="button" variant="outline" size="sm" :disabled="saving || parsedPaste.length === 0" @click="applyPaste(true)">
							Add as secrets
						</Button>
						<Button type="button" size="sm" :disabled="saving || parsedPaste.length === 0" @click="applyPaste(false)">Add as variables</Button>
					</div>
				</div>
			</div>
			<p v-if="state.env.length === 0" class="text-sm text-muted-foreground">No variables.</p>
			<div v-for="(item, index) in state.env" :key="item._id" class="flex items-center gap-2">
				<Input v-model="item.key" placeholder="KEY" class="flex-1 font-mono text-xs" :disabled="saving" />
				<ServiceSettingsReferenceInput
					v-model="item.value"
					:service-names="serviceNames"
					placeholder="value"
					class="w-full font-mono text-xs"
					:disabled="saving"
				/>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="shrink-0 text-muted-foreground hover:text-destructive"
					:disabled="saving"
					@click="removeEnv(index)"
				>
					<X />
				</Button>
			</div>
		</section>

		<Separator />

		<!-- Secrets -->
		<section class="flex flex-col gap-3">
			<div class="flex items-start justify-between gap-2">
				<div>
					<h3 class="text-sm font-medium">Secrets</h3>
					<p class="text-xs text-muted-foreground">
						Encrypted at rest and injected via a Kubernetes Secret — values are never shown again after saving.
					</p>
				</div>
				<Button type="button" variant="ghost" size="sm" @click="addSecret">
					<Plus />
					Add
				</Button>
			</div>
			<p v-if="state.secrets.length === 0" class="text-sm text-muted-foreground">No secrets.</p>
			<div v-for="(item, index) in state.secrets" :key="item._id" class="flex items-center gap-2">
				<div class="relative w-2/5 shrink-0">
					<KeyRound class="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input v-model="item.key" placeholder="KEY" class="w-full pl-8 font-mono text-xs" :disabled="saving" />
				</div>
				<div class="relative flex-1">
					<ServiceSettingsReferenceInput
						v-model="item.value"
						:service-names="serviceNames"
						:type="shownSecrets[item._id] ? 'text' : 'password'"
						autocomplete="new-password"
						:placeholder="item.hasValue ? '•••••••• (unchanged)' : 'value'"
						class="w-full pr-9 font-mono text-xs"
						:disabled="saving"
					/>
					<button
						type="button"
						tabindex="-1"
						class="absolute top-1/2 right-2 z-10 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
						:aria-label="shownSecrets[item._id] ? 'Hide value' : 'Show value'"
						@click="toggleSecret(item._id)"
					>
						<component :is="shownSecrets[item._id] ? EyeOff : Eye" class="size-3.5" />
					</button>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="shrink-0 text-muted-foreground hover:text-destructive"
					:disabled="saving"
					@click="removeSecret(index)"
				>
					<X />
				</Button>
			</div>
		</section>
	</div>
</template>
