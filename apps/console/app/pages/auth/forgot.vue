<script setup lang="ts">
definePageMeta({ layout: 'auth' });
</script>

<template>
	<AuthShell tagline="Reset your control plane password">
		<CardHeader>
			<CardTitle>Forgot your password?</CardTitle>
			<CardDescription>Enter your email and we'll send you a reset link.</CardDescription>
		</CardHeader>
		<CardContent>
			<ForgotPasswordForm />
		</CardContent>
	</AuthShell>
</template>
