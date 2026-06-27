<script setup lang="ts">
import * as z from 'zod';
import { Check, Pencil, Tag, X } from 'lucide-vue-next';

// The inline-edit team-name card (custom edit/view toggle).
const props = defineProps<{ team: { id: string; name: string }; isOwner: boolean }>();

const MAX_NAME_LENGTH = 100;

const editing = ref(false);
const inputRef = ref<{ $el?: HTMLInputElement } | null>(null);

const renameMutation = useRenameTeam(() => props.team.id);

const pending = computed(() => renameMutation.isPending.value);

const schema = z.object({
	name: z.string().trim().min(1, 'Enter a team name.').max(MAX_NAME_LENGTH, `Team name must be ${MAX_NAME_LENGTH} characters or fewer.`)
});

const { form, values } = useAppForm({
	schema,
	defaultValues: { name: props.team.name },
	onSubmit: ({ value }) => {
		const trimmed = value.name.trim();
		if (!trimmed || trimmed === props.team.name) {
			editing.value = false;
			return;
		}
		renameMutation.mutate(trimmed, { onSuccess: () => (editing.value = false) });
	}
});

const charCount = computed(() => values.value.name.length);
const overLimit = computed(() => charCount.value > MAX_NAME_LENGTH);
// `values` auto-unwraps in the template (so `values.value.X` is undefined there); derive the save guard in script instead.
const saveDisabled = computed(() => {
	const trimmed = values.value.name.trim();
	return pending.value || !trimmed || trimmed === props.team.name || overLimit.value;
});

// Sync form when the team changes externally.
watch(
	() => props.team.name,
	name => {
		form.reset({ name });
	}
);

// Focus the input when entering edit mode.
watch(editing, value => {
	if (value) {
		void nextTick(() => {
			inputRef.value?.$el?.focus();
		});
	}
});

function startEditing() {
	form.reset({ name: props.team.name });
	editing.value = true;
}

function cancelEditing() {
	form.reset({ name: props.team.name });
	editing.value = false;
}

function handleKeyDown(e: KeyboardEvent) {
	if (e.key === 'Enter') {
		e.preventDefault();
		form.handleSubmit();
	} else if (e.key === 'Escape') {
		e.preventDefault();
		cancelEditing();
	}
}
</script>

<template>
	<Card class="transition-shadow hover:shadow-sm">
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Tag class="size-4 text-muted-foreground/70" />
				Team name
			</CardTitle>
			<CardDescription>This is your team's display name across kubwave.</CardDescription>
		</CardHeader>

		<template v-if="editing">
			<AppForm :form="form">
				<CardContent>
					<div class="space-y-2">
						<Field name="name" v-slot="{ componentField }">
							<div class="relative">
								<Input
									v-bind="componentField"
									ref="inputRef"
									placeholder="Team name"
									:disabled="pending"
									:maxlength="MAX_NAME_LENGTH + 20"
									class="w-full pr-16"
									:class="overLimit ? 'ring-destructive/25' : ''"
									@keydown="handleKeyDown"
								/>
								<span
									class="absolute right-3 top-1/2 -translate-y-1/2 text-xs tabular-nums"
									:class="overLimit ? 'font-medium text-destructive' : 'text-muted-foreground/60'"
								>
									{{ charCount }}/{{ MAX_NAME_LENGTH }}
								</span>
							</div>
						</Field>
						<p v-if="!overLimit" class="text-xs text-muted-foreground/60">Press Enter to save, Esc to cancel.</p>
					</div>
				</CardContent>
				<CardFooter class="justify-end gap-2 border-t pt-6">
					<Button type="button" variant="outline" size="sm" :disabled="pending" @click="cancelEditing">
						<X />
						Cancel
					</Button>
					<Button type="submit" size="sm" :disabled="saveDisabled">
						<Check v-if="!pending" />
						{{ pending ? 'Saving…' : 'Save' }}
					</Button>
				</CardFooter>
			</AppForm>
		</template>

		<template v-else>
			<CardContent>
				<div class="flex items-center justify-between gap-3">
					<div>
						<p class="text-sm text-muted-foreground">Name</p>
						<p class="mt-0.5 font-medium" :class="!team.name ? 'italic text-muted-foreground/60' : ''">{{ team.name || 'Unnamed team' }}</p>
					</div>
					<Button v-if="isOwner" variant="outline" size="sm" class="shrink-0" @click="startEditing">
						<Pencil />
						Edit
					</Button>
				</div>
			</CardContent>
			<CardFooter v-if="!isOwner" class="border-t pt-6">
				<p class="text-xs text-muted-foreground">Only owners can rename the team.</p>
			</CardFooter>
		</template>
	</Card>
</template>
