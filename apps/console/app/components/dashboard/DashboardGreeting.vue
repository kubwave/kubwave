<script setup lang="ts">
const user = useSessionUser();
const firstName = computed(() => user.value?.name?.split(/\s+/)[0]);
</script>

<template>
	<PageHeader :title="`Welcome back${firstName ? `, ${firstName}` : ''}`">
		<template #description>
			Signed in as <span class="font-mono text-xs">{{ user?.email }}</span
			>.
		</template>
	</PageHeader>
</template>
