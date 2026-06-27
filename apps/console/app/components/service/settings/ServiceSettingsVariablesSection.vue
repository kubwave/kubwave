<script setup lang="ts">
import { Eye, EyeOff, KeyRound, Plus, X } from 'lucide-vue-next';
import type { Service } from '~/utils/types';
import type { ServiceSettingsValues } from '~/composables/use-service-settings-schema';

defineProps<{
	state: ServiceSettingsValues;
	saving: boolean;
	service: Service;
	shownSecrets: Record<string, boolean>;
	addEnv: () => void;
	removeEnv: (index: number) => void;
	addSecret: () => void;
	removeSecret: (index: number) => void;
	toggleSecret: (id: string) => void;
}>();
</script>

<template>
	<div class="flex flex-col gap-6">
		<!-- Environment variables -->
		<section class="flex flex-col gap-3">
			<div class="flex items-start justify-between gap-2">
				<div>
					<h3 class="text-sm font-medium">Environment variables</h3>
					<p class="text-xs text-muted-foreground">Injected into the container at runtime.</p>
				</div>
				<Button type="button" variant="ghost" size="sm" @click="addEnv">
					<Plus />
					Add
				</Button>
			</div>
			<p v-if="state.env.length === 0" class="text-sm text-muted-foreground">No variables.</p>
			<div v-for="(item, index) in state.env" :key="item._id" class="flex items-center gap-2">
				<Input v-model="item.key" placeholder="KEY" class="flex-1 font-mono text-xs" :disabled="saving" />
				<Input v-model="item.value" placeholder="value" class="flex-1 font-mono text-xs" :disabled="saving" />
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="shrink-0 text-muted-foreground hover:text-destructive"
					:disabled="saving"
					@click="removeEnv(index)"
				>
					<X />
				</Button>
			</div>
		</section>

		<Separator />

		<!-- Secrets -->
		<section class="flex flex-col gap-3">
			<div class="flex items-start justify-between gap-2">
				<div>
					<h3 class="text-sm font-medium">Secrets</h3>
					<p class="text-xs text-muted-foreground">
						Encrypted at rest and injected via a Kubernetes Secret — values are never shown again after saving.
					</p>
				</div>
				<Button type="button" variant="ghost" size="sm" @click="addSecret">
					<Plus />
					Add
				</Button>
			</div>
			<p v-if="state.secrets.length === 0" class="text-sm text-muted-foreground">No secrets.</p>
			<div v-for="(item, index) in state.secrets" :key="item._id" class="flex items-center gap-2">
				<div class="relative w-2/5 shrink-0">
					<KeyRound class="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input v-model="item.key" placeholder="KEY" class="w-full pl-8 font-mono text-xs" :disabled="saving" />
				</div>
				<div class="relative flex-1">
					<Input
						v-model="item.value"
						:type="shownSecrets[item._id] ? 'text' : 'password'"
						autocomplete="new-password"
						:placeholder="item.hasValue ? '•••••••• (unchanged)' : 'value'"
						class="w-full pr-9 font-mono text-xs"
						:disabled="saving"
					/>
					<button
						type="button"
						tabindex="-1"
						class="absolute top-1/2 right-2 z-10 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
						:aria-label="shownSecrets[item._id] ? 'Hide value' : 'Show value'"
						@click="toggleSecret(item._id)"
					>
						<component :is="shownSecrets[item._id] ? EyeOff : Eye" class="size-3.5" />
					</button>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="shrink-0 text-muted-foreground hover:text-destructive"
					:disabled="saving"
					@click="removeSecret(index)"
				>
					<X />
				</Button>
			</div>
		</section>
	</div>
</template>
