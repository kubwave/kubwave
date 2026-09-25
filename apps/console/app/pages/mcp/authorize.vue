<script setup lang="ts">
import { useMutation, useQuery } from '@tanstack/vue-query';
import type { McpAuthorizationDto } from '@kubwave/api-client';
import { Check, TriangleAlert } from 'lucide-vue-next';
import { MCP_EXPIRY_DAYS, mcpScope } from '~/utils/mcp';
import { queryKeys } from '~/utils/query-keys';

definePageMeta({ layout: 'auth' });
useHead({ title: 'Authorize AI client' });

const OAUTH_PARAMS = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'resource', 'scope', 'state'];

const api = useApi();
const route = useRoute();
const toast = useToast();
const { teams } = useTeamContext();

// The backend validates every field; unknown/missing ones surface as an invalid-request error below.
const request = Object.fromEntries(
	OAUTH_PARAMS.flatMap(key => (typeof route.query[key] === 'string' ? [[key, route.query[key]]] : []))
) as McpAuthorizationDto;

const {
	data: details,
	isPending,
	isError
} = useQuery({
	queryKey: queryKeys.mcpAuthorization(JSON.stringify(request)),
	queryFn: () => apiData(api.mcp.authorization.post(request)),
	retry: false
});

const teamId = ref('all');
const expiresInDays = ref('30');
const scopes = computed(() => (details.value?.scopes ?? []).map(mcpScope));
const redirectHost = computed(() => {
	const uri = details.value?.redirectUri ?? '';
	return (URL.canParse(uri) && new URL(uri).host) || uri;
});

const {
	mutate: decide,
	isPending: submitting,
	isSuccess: decided,
	variables: approving
} = useMutation({
	mutationFn: (approve: boolean) =>
		apiData(
			api.mcp.consent.post({
				...request,
				approve,
				teamId: teamId.value === 'all' ? undefined : teamId.value,
				expiresInDays: Number(expiresInDays.value)
			})
		),
	onSuccess: ({ redirectUrl }) => {
		window.location.href = redirectUrl;
	},
	onError: () => toast.error('Could not complete authorization', 'Start the connection again from your AI client.')
});
</script>

<template>
	<AuthShell tagline="Connect an AI client">
		<CardContent v-if="isPending" class="flex flex-col gap-3">
			<Skeleton class="h-5 w-48" />
			<Skeleton class="h-4 w-full" />
			<Skeleton class="h-24 w-full" />
		</CardContent>

		<template v-else-if="isError || !details">
			<CardHeader>
				<CardTitle>Invalid authorization request</CardTitle>
				<CardDescription>
					This link is invalid, expired, or does not match a registered client. Start the connection again from your AI client.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Button variant="outline" class="w-full" as-child>
					<NuxtLink to="/">Back to dashboard</NuxtLink>
				</Button>
			</CardContent>
		</template>

		<template v-else>
			<CardHeader>
				<CardTitle>Authorize {{ details.clientName }}</CardTitle>
				<CardDescription>{{ details.clientName }} wants to access Kubwave on your behalf.</CardDescription>
				<p class="text-xs text-muted-foreground">
					Redirects to <span class="font-mono">{{ redirectHost }}</span>
				</p>
			</CardHeader>
			<CardContent class="flex flex-col gap-5">
				<div class="flex flex-col gap-2">
					<p class="text-sm font-medium">Requested permissions</p>
					<ul class="flex flex-col gap-2">
						<li
							v-for="scope in scopes"
							:key="scope.value"
							:class="['flex gap-2 rounded-md border p-2.5 text-sm', scope.destructive ? 'border-destructive/40 bg-destructive/5' : '']"
						>
							<TriangleAlert v-if="scope.destructive" class="mt-0.5 size-4 shrink-0 text-destructive" />
							<Check v-else class="mt-0.5 size-4 shrink-0 text-primary" />
							<div>
								<p :class="['font-medium', scope.destructive ? 'text-destructive' : '']">{{ scope.label }}</p>
								<p class="text-xs text-muted-foreground">{{ scope.description }}</p>
							</div>
						</li>
					</ul>
				</div>

				<div class="flex flex-col gap-2">
					<Label for="mcp-team">Team access</Label>
					<Select v-model="teamId" :disabled="submitting || decided">
						<SelectTrigger id="mcp-team" class="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All my teams</SelectItem>
							<SelectItem v-for="team in teams" :key="team.id" :value="team.id">{{ team.name }}</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<div class="flex flex-col gap-2">
					<Label for="mcp-expiry">Expires after</Label>
					<Select v-model="expiresInDays" :disabled="submitting || decided">
						<SelectTrigger id="mcp-expiry" class="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem v-for="days in MCP_EXPIRY_DAYS" :key="days" :value="days">{{ days }} days</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<p v-if="decided" class="text-sm text-muted-foreground">Returning you to {{ details.clientName }}… You can close this tab.</p>
				<div v-else class="flex gap-2">
					<Button variant="outline" class="flex-1" :disabled="submitting" @click="decide(false)">
						{{ submitting && approving === false ? 'Denying…' : 'Deny' }}
					</Button>
					<Button class="flex-1" :disabled="submitting" @click="decide(true)">
						{{ submitting && approving === true ? 'Authorizing…' : 'Approve' }}
					</Button>
				</div>
			</CardContent>
		</template>
	</AuthShell>
</template>
