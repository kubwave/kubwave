<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue';
import type { ReferenceSuggestion } from '~/utils/service-references';

// Value input that suggests `${{services.<name>.<prop>}}` once `${{` is typed; extra attrs (type, placeholder, class, disabled) go to the input.
defineOptions({ inheritAttrs: false });

const props = defineProps<{ serviceNames: string[] }>();
const model = defineModel<string>({ default: '' });

const listId = useId();
const inputRef = useTemplateRef<ComponentPublicInstance>('input');
const query = ref<{ start: number; query: string } | null>(null);
const active = ref(0);

const suggestions = computed(() => (query.value ? referenceSuggestions(props.serviceNames, query.value.query) : []));
const open = computed(() => suggestions.value.length > 0);

function inputElement(): HTMLInputElement | null {
	return (inputRef.value?.$el as HTMLInputElement | undefined) ?? null;
}

function refresh() {
	const el = inputElement();
	query.value = el ? referenceQueryBefore(el.value.slice(0, el.selectionStart ?? el.value.length)) : null;
	active.value = 0;
}

function close() {
	query.value = null;
}

function accept(suggestion: ReferenceSuggestion) {
	const el = inputElement();
	if (!el || !query.value) return;
	const next = insertReference(el.value, query.value.start, el.selectionStart ?? el.value.length, suggestion.insert);
	model.value = next.text;
	close();
	nextTick(() => el.setSelectionRange(next.caret, next.caret));
}

function onKeydown(event: KeyboardEvent) {
	if (!open.value) return;
	const count = suggestions.value.length;
	if (event.key === 'ArrowDown') active.value = (active.value + 1) % count;
	else if (event.key === 'ArrowUp') active.value = (active.value - 1 + count) % count;
	else if (event.key === 'Enter' || event.key === 'Tab') accept(suggestions.value[active.value]!);
	else if (event.key === 'Escape') close();
	else return;
	event.preventDefault();
}
</script>

<template>
	<div class="relative flex-1">
		<Input
			ref="input"
			v-model="model"
			v-bind="$attrs"
			role="combobox"
			aria-autocomplete="list"
			:aria-expanded="open"
			:aria-controls="listId"
			:aria-activedescendant="open ? `${listId}-${active}` : undefined"
			@input="refresh"
			@click="refresh"
			@keydown="onKeydown"
			@blur="close"
		/>
		<ul
			v-if="open"
			:id="listId"
			role="listbox"
			class="absolute top-full right-0 z-50 mt-1 max-h-56 w-max max-w-[min(36rem,calc(100vw-2rem))] min-w-full overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-md"
		>
			<li
				v-for="(suggestion, index) in suggestions"
				:id="`${listId}-${index}`"
				:key="suggestion.label"
				role="option"
				:aria-selected="index === active"
				class="flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 aria-selected:bg-accent aria-selected:text-accent-foreground"
				@mousedown.prevent="accept(suggestion)"
				@mouseenter="active = index"
			>
				<span class="min-w-0 truncate font-mono">{{ suggestion.label }}</span>
				<span class="shrink-0 text-muted-foreground">{{ suggestion.detail }}</span>
			</li>
		</ul>
	</div>
</template>
