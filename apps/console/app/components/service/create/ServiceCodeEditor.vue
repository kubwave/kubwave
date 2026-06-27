<script setup lang="ts">
import { indentWithTab } from '@codemirror/commands';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { FileCode2 } from 'lucide-vue-next';

// CodeMirror editor for pasting service definitions (Compose/Dockerfile); client-only, so wrap consumers in <ClientOnly>.
const props = withDefaults(
	defineProps<{
		autofocus?: boolean;
		disabled?: boolean;
		placeholder?: string;
		filename?: string;
		languageLabel?: string;
	}>(),
	{
		autofocus: false,
		disabled: false,
		placeholder: undefined,
		filename: 'docker-compose.yml',
		languageLabel: 'YAML'
	}
);

const emit = defineEmits<{ blur: [] }>();

const model = defineModel<string>({ default: '' });

const codeHighlightStyle = HighlightStyle.define([
	{ tag: tags.definition(tags.propertyName), color: 'color-mix(in oklch, var(--primary) 78%, var(--foreground))', fontWeight: '500' },
	{ tag: tags.content, color: 'var(--foreground)' },
	{ tag: tags.string, color: 'color-mix(in oklch, oklch(0.78 0.12 78) 72%, var(--foreground))' },
	{ tag: tags.attributeValue, color: 'color-mix(in oklch, oklch(0.78 0.12 78) 66%, var(--foreground))' },
	{ tag: [tags.number, tags.bool], color: 'color-mix(in oklch, oklch(0.72 0.11 238) 64%, var(--foreground))' },
	{ tag: [tags.keyword, tags.typeName, tags.labelName], color: 'color-mix(in oklch, var(--primary) 62%, var(--foreground))' },
	{ tag: tags.lineComment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
	{ tag: [tags.separator, tags.punctuation, tags.squareBracket, tags.brace], color: 'color-mix(in oklch, var(--muted-foreground) 72%, transparent)' },
	{ tag: tags.meta, color: 'var(--muted-foreground)' }
]);

const editorTheme = EditorView.theme({
	'&': {
		height: '20rem',
		backgroundColor: 'color-mix(in oklch, var(--background) 54%, var(--card))',
		color: 'var(--foreground)',
		fontSize: '0.75rem'
	},
	'&.cm-focused': {
		outline: 'none'
	},
	'.cm-scroller': {
		overflow: 'auto',
		fontFamily: 'var(--font-mono)',
		lineHeight: '1.55'
	},
	'.cm-content': {
		minHeight: '20rem',
		padding: '0.875rem 0',
		caretColor: 'var(--foreground)'
	},
	'.cm-line': {
		padding: '0 1rem 0 0.875rem'
	},
	'.cm-gutters': {
		backgroundColor: 'color-mix(in oklch, var(--muted) 35%, transparent)',
		color: 'color-mix(in oklch, var(--muted-foreground) 78%, transparent)',
		borderRight: '1px solid var(--border)'
	},
	'.cm-lineNumbers .cm-gutterElement': {
		minWidth: '2.625rem',
		padding: '0 0.75rem 0 0.8125rem'
	},
	'.cm-foldGutter .cm-gutterElement': {
		padding: '0 0.375rem',
		color: 'color-mix(in oklch, var(--muted-foreground) 68%, transparent)'
	},
	'.cm-activeLine': {
		backgroundColor: 'color-mix(in oklch, var(--muted) 38%, transparent)'
	},
	'.cm-activeLineGutter': {
		backgroundColor: 'color-mix(in oklch, var(--muted) 46%, transparent)',
		color: 'color-mix(in oklch, var(--foreground) 76%, var(--muted-foreground))'
	},
	'.cm-cursor': {
		borderLeftColor: 'var(--primary)'
	},
	'.cm-matchingBracket, .cm-nonmatchingBracket': {
		backgroundColor: 'color-mix(in oklch, var(--primary) 12%, transparent)',
		outline: '1px solid color-mix(in oklch, var(--primary) 24%, transparent)'
	},
	'.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
		backgroundColor: 'color-mix(in oklch, var(--primary) 24%, transparent)'
	},
	'.cm-searchMatch': {
		backgroundColor: 'color-mix(in oklch, oklch(0.78 0.12 78) 28%, transparent)'
	},
	'.cm-searchMatch-selected': {
		backgroundColor: 'color-mix(in oklch, oklch(0.78 0.12 78) 42%, transparent)'
	},
	'.cm-tooltip': {
		backgroundColor: 'var(--popover)',
		color: 'var(--popover-foreground)',
		border: '1px solid var(--border)',
		borderRadius: '0.375rem',
		boxShadow: '0 10px 30px rgb(0 0 0 / 0.12)'
	}
});

const editorHost = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
const focused = ref(false);

const lineCount = computed(() => Math.max(1, (model.value ?? '').split('\n').length));

// `disabled` flips EditorView.editable, which can't toggle in place, so the view is rebuilt on change (watch below).
function buildExtensions() {
	return [
		keymap.of([indentWithTab]),
		basicSetup,
		yaml(),
		syntaxHighlighting(codeHighlightStyle),
		editorTheme,
		EditorView.lineWrapping,
		EditorView.editable.of(!props.disabled),
		EditorView.updateListener.of(update => {
			// Sync OUTWARD: push the editor's own edits back into the model.
			if (update.docChanged) model.value = update.state.doc.toString();
			if (update.focusChanged) {
				const hasFocus = update.view.hasFocus;
				focused.value = hasFocus;
				if (!hasFocus) emit('blur');
			}
		})
	];
}

function createView(doc: string) {
	if (!editorHost.value) return;
	view = new EditorView({ doc, extensions: buildExtensions(), parent: editorHost.value });
}

onMounted(() => {
	createView(model.value ?? '');
	if (props.autofocus && !props.disabled) {
		window.requestAnimationFrame(() => view?.focus());
	}
});

onBeforeUnmount(() => {
	view?.destroy();
	view = null;
});

// Sync INWARD: reflect external model changes, guarding against echoing the editor's own edit (which resets the cursor).
watch(model, newVal => {
	if (!view) return;
	if ((newVal ?? '') === view.state.doc.toString()) return;
	view.dispatch({
		changes: { from: 0, to: view.state.doc.length, insert: newVal ?? '' }
	});
});

// Rebuild the view on `disabled` toggle (EditorView.editable can't change in place).
watch(
	() => props.disabled,
	() => {
		if (!view) return;
		const doc = view.state.doc.toString();
		view.destroy();
		createView(doc);
	}
);
</script>

<template>
	<div
		:data-disabled="disabled ? 'true' : undefined"
		data-slot="code-editor"
		class="overflow-hidden rounded-md border border-input bg-background/40 shadow-xs transition-[border-color,box-shadow,opacity] focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/35 data-[disabled=true]:opacity-60"
	>
		<div class="flex h-9 items-center justify-between gap-3 border-b bg-muted/20 px-3 text-xs text-muted-foreground">
			<div class="flex min-w-0 items-center gap-2">
				<FileCode2 class="size-3.5 shrink-0 text-muted-foreground/75" />
				<span class="truncate font-mono text-foreground/70">{{ filename }}</span>
				<span class="text-muted-foreground/45">{{ languageLabel }}</span>
			</div>
			<span class="shrink-0 font-mono text-muted-foreground/75 tabular-nums"> {{ lineCount }} {{ lineCount === 1 ? 'line' : 'lines' }} </span>
		</div>
		<div class="relative">
			<div ref="editorHost" />
			<pre
				v-if="!model && !focused && placeholder"
				aria-hidden="true"
				class="pointer-events-none absolute top-3 left-[4.15rem] m-0 max-w-[calc(100%-5rem)] overflow-hidden font-mono text-xs leading-[1.55] whitespace-pre-wrap text-muted-foreground/65"
				>{{ placeholder }}</pre
			>
		</div>
	</div>
</template>
