<script setup lang="ts">
definePageMeta({ layout: 'auth' });
</script>

<template>
	<AuthShell tagline="Sign in to your control plane">
		<CardHeader>
			<CardTitle>Welcome back</CardTitle>
			<CardDescription>Enter your credentials to continue.</CardDescription>
		</CardHeader>
		<CardContent>
			<LoginForm />
		</CardContent>
	</AuthShell>
</template>
