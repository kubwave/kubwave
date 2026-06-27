<script setup lang="ts">
import { UserPlus } from 'lucide-vue-next';

defineProps<{ activeTeamId: string | null; isOwner: boolean }>();

const open = ref(false);
</script>

<template>
	<div>
		<Button size="sm" :disabled="!isOwner" :title="isOwner ? undefined : 'Only owners can add members'" class="shrink-0" @click="open = true">
			<UserPlus />
			Add member
		</Button>
		<TeamAddMemberModal v-if="activeTeamId" v-model:open="open" :team-id="activeTeamId" />
	</div>
</template>
