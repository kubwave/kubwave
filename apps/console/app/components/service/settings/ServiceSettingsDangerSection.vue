<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next';
import type { Service } from '~/utils/types';

defineProps<{
	service: Service;
}>();

defineEmits<{ delete: [] }>();
</script>

<template>
	<div class="flex flex-col gap-6">
		<section class="flex flex-col gap-3">
			<div class="flex items-start justify-between gap-2">
				<div>
					<h3 class="text-sm font-medium">Danger area</h3>
					<p class="text-xs text-muted-foreground">Irreversible actions.</p>
				</div>
			</div>
			<div class="flex items-center justify-between rounded-md border border-destructive/30 px-3 py-2.5">
				<div>
					<p class="text-sm font-medium">Delete service</p>
					<p class="text-sm text-muted-foreground">Removes it from this environment.</p>
				</div>
				<Button
					type="button"
					variant="outline"
					class="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
					@click="$emit('delete')"
				>
					<Trash2 />
					Delete
				</Button>
			</div>
		</section>
	</div>
</template>
