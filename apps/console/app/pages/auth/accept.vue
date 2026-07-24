<script setup lang="ts">
import { Link2Off } from 'lucide-vue-next';

definePageMeta({ layout: 'auth' });

const token = useRoute().query.token;
const tokenStr = typeof token === 'string' ? token : null;
</script>

<template>
	<AuthShell tagline="Join your team on kubwave">
		<CardHeader>
			<template v-if="tokenStr">
				<CardTitle>Accept your invite</CardTitle>
				<CardDescription>Choose a name and password to finish.</CardDescription>
			</template>
			<template v-else>
				<div class="mb-3 flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
					<Link2Off class="size-5" />
				</div>
				<CardTitle>Invalid invite link</CardTitle>
				<CardDescription>This link is missing its token. Ask an admin to resend the invite.</CardDescription>
			</template>
		</CardHeader>
		<CardContent>
			<AcceptInviteForm v-if="tokenStr" :token="tokenStr" />

			<Button v-else variant="outline" class="w-full" as-child>
				<NuxtLink to="/auth/login">Back to sign in</NuxtLink>
			</Button>
		</CardContent>
	</AuthShell>
</template>
