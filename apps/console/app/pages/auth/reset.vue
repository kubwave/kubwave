<script setup lang="ts">
definePageMeta({ layout: 'auth' });

const token = useRoute().query.token;
const tokenStr = typeof token === 'string' ? token : null;
</script>

<template>
	<AuthShell tagline="Choose a new password">
		<CardHeader>
			<template v-if="tokenStr">
				<CardTitle>Reset your password</CardTitle>
				<CardDescription>Choose a new password for your account.</CardDescription>
			</template>
			<template v-else>
				<CardTitle>Invalid reset link</CardTitle>
				<CardDescription>This link is missing its token. Request a new one from the sign-in page.</CardDescription>
			</template>
		</CardHeader>
		<CardContent>
			<ResetPasswordForm v-if="tokenStr" :token="tokenStr" />

			<Button v-else variant="outline" class="w-full" as-child>
				<NuxtLink to="/auth/forgot">Request a new link</NuxtLink>
			</Button>
		</CardContent>
	</AuthShell>
</template>
