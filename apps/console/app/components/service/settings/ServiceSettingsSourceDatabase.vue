<script setup lang="ts">
import { Copy, Eye, EyeOff } from 'lucide-vue-next';
import type { Service } from '~/utils/types';
import type { ServiceSettingsValues } from '~/composables/use-service-settings-schema';
import { DATABASE_ENGINE_UI, type DatabaseEngine } from '~/utils/database-engines';

const props = defineProps<{
	state: ServiceSettingsValues;
	saving: boolean;
	service: Service;
}>();

const engine = computed(() => props.service.type as DatabaseEngine);
const ui = computed(() => DATABASE_ENGINE_UI[engine.value]);

const toast = useToast();

// Connection details (incl. the generated password) come from a dedicated endpoint, never the normal service payload.
const { data: connection, isPending: loading, isError: loadError } = useServiceConnection(() => props.service.id);

const revealed = ref(false);

async function copy(value: string, label: string) {
	try {
		await navigator.clipboard.writeText(value);
		toast.success(`${label} copied`);
	} catch {
		toast.error('Could not copy to clipboard');
	}
}

const maskedPassword = computed(() => (connection.value ? (revealed.value ? connection.value.password : '•'.repeat(16)) : ''));
</script>

<template>
	<div class="flex flex-col gap-6">
		<section class="flex flex-col gap-3">
			<div>
				<h3 class="text-sm font-medium">{{ ui.label }}</h3>
				<p class="text-xs text-muted-foreground">The engine version and how much storage backs the database.</p>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<ServiceSettingsField name="version" label="Version">
					<Select v-model="state.version" :disabled="saving">
						<SelectTrigger class="w-full">
							<SelectValue placeholder="Select a version" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem v-for="version in ui.versions" :key="version" :value="version">{{ version }}</SelectItem>
						</SelectContent>
					</Select>
				</ServiceSettingsField>
				<ServiceSettingsField name="storage" label="Storage" description="Storage can be grown but never shrunk.">
					<Input v-model="state.storage" placeholder="1Gi" class="w-full" :disabled="saving" />
				</ServiceSettingsField>
			</div>
		</section>

		<section class="flex flex-col gap-3">
			<div class="flex items-center justify-between gap-2">
				<div>
					<h3 class="text-sm font-medium">Connection</h3>
					<p class="text-xs text-muted-foreground">Reference these from another service's variables to connect over the internal network.</p>
				</div>
				<Button v-if="connection" type="button" size="sm" variant="ghost" @click="revealed = !revealed">
					<component :is="revealed ? EyeOff : Eye" />
					{{ revealed ? 'Hide' : 'Reveal' }}
				</Button>
			</div>

			<Skeleton v-if="loading" class="h-44 w-full rounded-lg" />

			<p v-else-if="loadError" class="text-sm text-destructive">Could not load connection details.</p>

			<div v-else-if="connection" class="overflow-hidden rounded-lg border">
				<dl class="divide-y divide-border text-sm">
					<div
						v-for="row in [
							{ label: 'Host', value: connection.host },
							{ label: 'Port', value: String(connection.port) },
							{ label: 'Database', value: connection.database },
							{ label: 'Username', value: connection.username }
						]"
						:key="row.label"
						class="flex items-center justify-between gap-3 px-3 py-2"
					>
						<dt class="text-muted-foreground">{{ row.label }}</dt>
						<dd class="flex min-w-0 items-center gap-2">
							<span class="truncate font-mono text-xs">{{ row.value }}</span>
							<Button type="button" size="icon" variant="ghost" class="size-7" :aria-label="`Copy ${row.label}`" @click="copy(row.value, row.label)">
								<Copy class="size-3.5" />
							</Button>
						</dd>
					</div>
					<div class="flex items-center justify-between gap-3 px-3 py-2">
						<dt class="text-muted-foreground">Password</dt>
						<dd class="flex min-w-0 items-center gap-2">
							<span class="truncate font-mono text-xs">{{ maskedPassword }}</span>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								class="size-7"
								aria-label="Copy password"
								@click="copy(connection.password, 'Password')"
							>
								<Copy class="size-3.5" />
							</Button>
						</dd>
					</div>
				</dl>
				<div class="flex items-center justify-between gap-3 border-t bg-muted/30 px-3 py-2">
					<span class="truncate font-mono text-xs text-muted-foreground">{{
						revealed ? connection.uri : connection.uri.replace(connection.password, '••••')
					}}</span>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						class="size-7"
						aria-label="Copy connection string"
						@click="copy(connection.uri, 'Connection string')"
					>
						<Copy class="size-3.5" />
					</Button>
				</div>
			</div>
		</section>
	</div>
</template>
