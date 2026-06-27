<script setup lang="ts">
useHead({
	titleTemplate: title => (title ? `${title} · kubwave` : 'kubwave')
});
</script>

<template>
	<NuxtLayout>
		<NuxtPage />
	</NuxtLayout>
	<ConfirmHost />
	<ClientOnly>
		<Sonner position="bottom-right" :duration="4500" />
	</ClientOnly>
</template>
