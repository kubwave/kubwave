<script setup lang="ts">
import { KeyRound } from 'lucide-vue-next';

defineProps<{ activeTeamId: string | null; isOwner: boolean }>();

const open = ref(false);
</script>

<template>
	<div>
		<Button size="sm" :disabled="!isOwner" :title="isOwner ? undefined : 'Only owners can add SSH keys'" class="shrink-0" @click="open = true">
			<KeyRound />
			Add SSH key
		</Button>
		<TeamAddSshKeyModal v-if="activeTeamId" v-model:open="open" :team-id="activeTeamId" />
	</div>
</template>
