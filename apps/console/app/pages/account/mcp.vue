<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { Copy } from 'lucide-vue-next';
import { queryKeys } from '~/utils/query-keys';

useHead({ title: 'AI access (MCP)' });

const api = useApi();
const toast = useToast();
const { data: info } = useQuery({ queryKey: queryKeys.mcpInfo, queryFn: () => apiData(api.mcp.info.get()) });

async function copyEndpoint() {
	if (!info.value) return;
	try {
		await navigator.clipboard.writeText(info.value.endpoint);
		toast.success('Endpoint copied');
	} catch {
		toast.error('Could not copy to clipboard');
	}
}
</script>

<template>
	<div class="mx-auto flex max-w-3xl flex-col gap-6">
		<PageHeader title="AI access (MCP)" description="Let AI clients like Claude Code operate Kubwave for you via the Model Context Protocol." />

		<Card>
			<CardHeader>
				<CardTitle>Connect with OAuth</CardTitle>
				<CardDescription>
					OAuth-capable clients only need the endpoint URL. They open a browser window where you approve the requested scopes — no token needed.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Skeleton v-if="!info" class="h-9 w-full" />
				<div v-else class="relative">
					<Input :model-value="info.endpoint" readonly class="pr-10 font-mono text-xs" />
					<Button
						type="button"
						size="icon"
						variant="ghost"
						class="absolute top-1/2 right-1 size-7 -translate-y-1/2"
						aria-label="Copy endpoint"
						@click="copyEndpoint"
					>
						<Copy class="size-3.5" />
					</Button>
				</div>
			</CardContent>
		</Card>

		<McpTokenCreateCard />
		<McpAccessList />
	</div>
</template>
