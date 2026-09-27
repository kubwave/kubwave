<script setup lang="ts">
import * as z from 'zod';
import { useQueryClient } from '@tanstack/vue-query';
import type { McpCreatedAccessDto } from '@kubwave/api-client';
import { Copy, TriangleAlert } from 'lucide-vue-next';
import { MCP_EXPIRY_DAYS, MCP_SCOPES, type McpScope } from '~/utils/mcp';
import { queryKeys } from '~/utils/query-keys';

const api = useApi();
const queryClient = useQueryClient();
const toast = useToast();
const { teams } = useTeamContext();

// Shown once; kept only in component state, never persisted.
const created = ref<McpCreatedAccessDto | null>(null);

const schema = z.object({
	name: z.string().trim().min(1, 'Enter a name.').max(100, 'Name is too long.'),
	scopes: z.array(z.enum(MCP_SCOPES.map(scope => scope.value) as [McpScope, ...McpScope[]])).min(1, 'Pick at least one scope.'),
	teamId: z.string(),
	expiresInDays: z.enum(MCP_EXPIRY_DAYS)
});

const { form, isSubmitting } = useAppForm({
	schema,
	defaultValues: { name: '', scopes: ['read'] as McpScope[], teamId: 'all', expiresInDays: '30' as (typeof MCP_EXPIRY_DAYS)[number] },
	onSubmit: async ({ value }) => {
		const result = await apiData(
			api.mcp.access.post({
				name: value.name,
				scopes: value.scopes,
				teamId: value.teamId === 'all' ? undefined : value.teamId,
				expiresInDays: Number(value.expiresInDays)
			})
		).catch(() => null);
		if (!result) {
			toast.error('Could not create token', 'Please try again.');
			return;
		}
		created.value = result;
		form.reset();
		await queryClient.invalidateQueries({ queryKey: queryKeys.mcpAccess });
	}
});

function toggleScope(current: McpScope[], scope: McpScope, checked: boolean | 'indeterminate') {
	return checked === true ? [...current, scope] : current.filter(value => value !== scope);
}

const snippets = computed(() => {
	if (!created.value) return [];
	const { endpoint, token } = created.value;
	const config = { mcpServers: { kubwave: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${token}` } } } };
	return [
		{ label: 'Claude Code', value: `claude mcp add --transport http kubwave ${endpoint} --header "Authorization: Bearer ${token}"` },
		{ label: 'JSON config (Cursor, Claude Desktop, …)', value: JSON.stringify(config, null, 2) },
		{ label: 'Stdio via the kubwave CLI', value: `KUBWAVE_URL=${new URL(endpoint).origin} KUBWAVE_MCP_TOKEN=${token} kubwave mcp` }
	];
});

async function copy(value: string, label: string) {
	try {
		await navigator.clipboard.writeText(value);
		toast.success(`${label} copied`);
	} catch {
		toast.error('Could not copy to clipboard');
	}
}
</script>

<template>
	<Card>
		<CardHeader>
			<CardTitle>{{ created ? 'Token created' : 'Create personal token' }}</CardTitle>
			<CardDescription v-if="created">Copy the token now. It will not be shown again.</CardDescription>
			<CardDescription v-else>For clients without OAuth, or for scripts. The token acts as you, limited to the chosen scopes.</CardDescription>
		</CardHeader>

		<CardContent v-if="created" class="flex flex-col gap-4">
			<div class="relative">
				<Input :model-value="created.token" readonly class="pr-10 font-mono text-xs" />
				<Button
					type="button"
					size="icon"
					variant="ghost"
					class="absolute top-1/2 right-1 size-7 -translate-y-1/2"
					aria-label="Copy token"
					@click="copy(created.token, 'Token')"
				>
					<Copy class="size-3.5" />
				</Button>
			</div>

			<div v-for="snippet in snippets" :key="snippet.label" class="flex flex-col gap-1.5">
				<div class="flex items-center justify-between gap-2">
					<p class="text-sm font-medium">{{ snippet.label }}</p>
					<Button type="button" variant="ghost" size="sm" @click="copy(snippet.value, snippet.label)">
						<Copy />
						Copy
					</Button>
				</div>
				<pre class="overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-xs whitespace-pre">{{ snippet.value }}</pre>
			</div>

			<div class="flex justify-end">
				<Button type="button" @click="created = null">Done</Button>
			</div>
		</CardContent>

		<CardContent v-else>
			<AppForm :form="form" class="flex flex-col gap-4">
				<Field v-slot="{ componentField }" name="name" label="Name" description="A label to recognise this token by.">
					<Input v-bind="componentField" placeholder="laptop claude-code" autocomplete="off" :disabled="isSubmitting" />
				</Field>

				<Field v-slot="{ componentField, value }" name="scopes" label="Scopes">
					<div class="flex flex-col gap-2.5">
						<label v-for="scope in MCP_SCOPES" :key="scope.value" class="flex items-start gap-2.5 text-sm">
							<Checkbox
								class="mt-0.5"
								:model-value="(value as McpScope[]).includes(scope.value)"
								:disabled="isSubmitting"
								@update:model-value="checked => componentField['onUpdate:modelValue'](toggleScope(value as McpScope[], scope.value, checked))"
							/>
							<span>
								<span :class="['flex items-center gap-1 font-medium', scope.destructive ? 'text-destructive' : '']">
									{{ scope.label }}
									<TriangleAlert v-if="scope.destructive" class="size-3.5" />
								</span>
								<span class="block text-xs text-muted-foreground">{{ scope.description }}</span>
							</span>
						</label>
					</div>
				</Field>

				<div class="grid gap-4 sm:grid-cols-2">
					<Field v-slot="{ componentField }" name="teamId" label="Team access">
						<Select v-bind="componentField" :disabled="isSubmitting">
							<SelectTrigger class="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All my teams</SelectItem>
								<SelectItem v-for="team in teams" :key="team.id" :value="team.id">{{ team.name }}</SelectItem>
							</SelectContent>
						</Select>
					</Field>

					<Field v-slot="{ componentField }" name="expiresInDays" label="Expires after">
						<Select v-bind="componentField" :disabled="isSubmitting">
							<SelectTrigger class="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem v-for="days in MCP_EXPIRY_DAYS" :key="days" :value="days">{{ days }} days</SelectItem>
							</SelectContent>
						</Select>
					</Field>
				</div>

				<div class="flex justify-end">
					<Button type="submit" :disabled="isSubmitting">{{ isSubmitting ? 'Creating…' : 'Create token' }}</Button>
				</div>
			</AppForm>
		</CardContent>
	</Card>
</template>
