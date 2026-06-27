<script setup lang="ts">
import { FileText, Plus, X } from 'lucide-vue-next';
import type { Service } from '~/utils/types';
import type { ServiceSettingsValues } from '~/composables/use-service-settings-schema';

defineProps<{
	state: ServiceSettingsValues;
	saving: boolean;
	service: Service;
	addConfigFile: () => void;
	removeConfigFile: (index: number) => void;
}>();

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
						rest.
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
