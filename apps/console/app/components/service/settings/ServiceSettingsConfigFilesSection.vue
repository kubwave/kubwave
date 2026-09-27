<script setup lang="ts">
import type { CompletionSource } from '@codemirror/autocomplete';
import { FileText, Plus, X } from 'lucide-vue-next';
import type { Service } from '~/utils/types';
import type { ServiceSettingsValues } from '~/composables/use-service-settings-schema';

const props = defineProps<{
	state: ServiceSettingsValues;
	saving: boolean;
	service: Service;
	addConfigFile: () => void;
	removeConfigFile: (index: number) => void;
}>();

// Strings, not template text: Vue would treat the `{{ }}` as interpolation.
const referenceTrigger = '${{';
const referenceExample = '${{services.<name>.<prop>}}';

const { data: environmentServices } = useEnvironmentServices(() => props.service.environmentId);

// Reads the names on every completion, so the editor needn't be rebuilt when the services query resolves.
const referenceCompletions: CompletionSource = context => {
	const typed = context.matchBefore(/\$\{\{[^}\n]*$/);
	if (!typed) return null;
	const serviceNames = (environmentServices.value ?? []).map(s => s.name);
	return {
		from: typed.from,
		filter: false,
		options: referenceSuggestions(serviceNames, typed.text.slice(3)).map(suggestion => ({
			label: suggestion.label,
			detail: suggestion.detail,
			apply: (view, _completion, from, to) => {
				const closingBraces = view.state.sliceDoc(to, to + 2) === '}}' ? 2 : 0;
				view.dispatch({
					changes: { from, to: to + closingBraces, insert: suggestion.insert },
					selection: { anchor: from + suggestion.insert.length }
				});
			}
		}))
	};
};

// Display label for the editor header; highlighting itself is YAML-flavoured (CodeMirror).
function languageLabelFor(path: string): string {
	if (path.endsWith('.sql')) return 'SQL';
	if (path.endsWith('.json')) return 'JSON';
	if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'YAML';
	return 'Text';
}
</script>

<template>
	<div class="flex flex-col gap-6">
		<!-- Config files -->
		<section class="flex flex-col gap-3">
			<div class="flex items-start justify-between gap-2">
				<div>
					<h3 class="text-sm font-medium">Config files</h3>
					<p class="text-xs text-muted-foreground">
						Files rendered and mounted into the container at the given path (e.g. /etc/kong.yml). Content may include secrets — it is encrypted at
						rest. Type <code class="font-mono">{{ referenceTrigger }}</code> for service references like
						<code class="font-mono">{{ referenceExample }}</code
						>, resolved on every deploy.
					</p>
				</div>
				<Button type="button" variant="ghost" size="sm" :disabled="saving" @click="addConfigFile">
					<Plus />
					Add
				</Button>
			</div>
			<p v-if="state.configFiles.length === 0" class="text-sm text-muted-foreground">No config files.</p>
			<ServiceSettingsField v-for="(item, index) in state.configFiles" :key="item._id" :name="`configFiles.${index}.path`">
				<div class="flex flex-col gap-2">
					<div class="flex items-center gap-2">
						<div class="relative flex-1">
							<FileText class="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input v-model="item.path" placeholder="/etc/config.yml" class="w-full pl-8 font-mono text-xs" :disabled="saving" />
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							class="shrink-0 text-muted-foreground hover:text-destructive"
							:disabled="saving"
							@click="removeConfigFile(index)"
						>
							<X />
						</Button>
					</div>
					<ClientOnly>
						<ServiceCodeEditor
							v-model="item.content"
							:filename="item.path || 'config file'"
							:language-label="languageLabelFor(item.path)"
							placeholder="File contents"
							:disabled="saving"
							:completion-source="referenceCompletions"
						/>
						<template #fallback>
							<Skeleton class="h-80 w-full rounded-md" />
						</template>
					</ClientOnly>
				</div>
			</ServiceSettingsField>
		</section>
	</div>
</template>
