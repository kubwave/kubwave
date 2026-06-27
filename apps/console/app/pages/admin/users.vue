<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query';
import { invitationsQuery } from '~/composables/use-admin-invitations';
import { adminUsersQuery } from '~/composables/use-admin-users';

// SSR-prefetches the admin users + invitations lists (same keys the tables read), then renders the
// header + body. Admin-gated.
definePageMeta({ middleware: 'admin' });
useHead({ title: 'Users' });

const api = useApi();
const queryClient = useQueryClient();

onServerPrefetch(() => Promise.all([queryClient.prefetchQuery(adminUsersQuery(api)), queryClient.prefetchQuery(invitationsQuery(api))]));
</script>

<template>
	<div class="flex flex-col gap-6">
		<AdminUsersHeader />
		<AdminUsersStats />
		<AdminUsersTabs />
	</div>
</template>
