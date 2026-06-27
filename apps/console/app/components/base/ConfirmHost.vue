<script setup lang="ts">
// Single global confirm dialog driven by useConfirm(); mounted once in app.vue.
const request = useConfirmRequest();
const typed = ref('');

watch(request, () => {
	typed.value = '';
});

const needsText = computed(() => Boolean(request.value?.confirmationText));
const canConfirm = computed(() => !needsText.value || typed.value === request.value?.confirmationText);

function settle(value: boolean) {
	request.value?.resolve(value);
	request.value = null;
}
</script>

<template>
	<Dialog :open="request !== null" @update:open="value => !value && settle(false)">
		<DialogContent class="z-[60] max-w-sm" overlay-class="z-[60]">
			<DialogHeader>
				<DialogTitle>{{ request?.title }}</DialogTitle>
				<DialogDescription v-if="request?.description">{{ request.description }}</DialogDescription>
			</DialogHeader>

			<div v-if="needsText" class="flex flex-col gap-1.5">
				<p class="text-sm text-muted-foreground">
					Type <span class="font-mono font-medium text-foreground">{{ request?.confirmationText }}</span> to confirm.
				</p>
				<Input v-model="typed" autofocus aria-label="Confirmation text" @keydown.enter="canConfirm && settle(true)" />
			</div>

			<DialogFooter>
				<Button variant="outline" @click="settle(false)">{{ request?.cancelLabel ?? 'Cancel' }}</Button>
				<Button :variant="request?.destructive ? 'destructive' : 'default'" :disabled="!canConfirm" @click="settle(true)">
					{{ request?.confirmLabel ?? 'Confirm' }}
				</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>
</template>
