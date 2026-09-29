'use client';

import { autocompletion, type CompletionSource } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import { referenceSuggestions } from '@/lib/service-references';
import { cn } from '@/lib/utils';

const highlight = HighlightStyle.define([
	{ tag: tags.definition(tags.propertyName), color: 'var(--primary-text)', fontWeight: '500' },
	{ tag: [tags.string, tags.attributeValue], color: 'var(--chart-4)' },
	{ tag: [tags.number, tags.bool], color: 'var(--chart-1)' },
	{ tag: [tags.keyword, tags.typeName, tags.labelName], color: 'var(--primary-text)' },
	{ tag: tags.lineComment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
	{ tag: [tags.separator, tags.punctuation, tags.squareBracket, tags.brace, tags.meta], color: 'var(--muted-foreground)' }
]);

const theme = EditorView.theme({
	'&': { backgroundColor: 'var(--card)', color: 'var(--foreground)', fontSize: '0.75rem', height: '100%' },
	'&.cm-focused': { outline: 'none' },
	'.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
	'.cm-content': { padding: '0.75rem 0', caretColor: 'var(--foreground)' },
	'.cm-gutters': { backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)', borderRight: '1px solid var(--border)' },
	'.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)' },
	'.cm-cursor': { borderLeftColor: 'var(--foreground)' },
	'.cm-tooltip': {
		backgroundColor: 'var(--popover)',
		color: 'var(--popover-foreground)',
		border: '1px solid var(--border)',
		borderRadius: '0.375rem'
	}
});

// Suggests `${{services.<name>.<prop>}}` after "${{". Reads the names on every completion, so the
// editor needs no rebuild when the service list loads.
export function referenceCompletions(serviceNames: () => string[]): CompletionSource {
	return context => {
		const typed = context.matchBefore(/\$\{\{[^}\n]*$/);
		if (!typed) return null;
		return {
			from: typed.from,
			filter: false,
			options: referenceSuggestions(serviceNames(), typed.text.slice(3)).map(suggestion => ({
				label: suggestion.label,
				detail: suggestion.detail,
				apply: (view, _completion, from, to) => {
					const closing = view.state.sliceDoc(to, to + 2) === '}}' ? 2 : 0;
					view.dispatch({ changes: { from, to: to + closing, insert: suggestion.insert }, selection: { anchor: from + suggestion.insert.length } });
				}
			}))
		};
	};
}

type Props = {
	value: string;
	onChange: (value: string) => void;
	completions?: CompletionSource;
	placeholder?: string;
	disabled?: boolean;
	autoFocus?: boolean;
	className?: string;
	'aria-label'?: string;
};

// YAML-highlighted CodeMirror editor. Browser only: render it from client components.
export function CodeEditor({
	value,
	onChange,
	completions,
	placeholder,
	disabled = false,
	autoFocus = false,
	className,
	'aria-label': ariaLabel
}: Props) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView | null>(null);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	useEffect(() => {
		if (!host.current) return;
		const editor = new EditorView({
			parent: host.current,
			doc: value,
			extensions: [
				basicSetup,
				keymap.of([indentWithTab]),
				yaml(),
				syntaxHighlighting(highlight),
				theme,
				EditorView.editable.of(!disabled),
				EditorView.contentAttributes.of(ariaLabel ? { 'aria-label': ariaLabel } : {}),
				...(placeholder ? [placeholderExtension(placeholder)] : []),
				...(completions ? [autocompletion({ override: [completions] })] : []),
				EditorView.updateListener.of(update => {
					if (update.docChanged) onChangeRef.current(update.state.doc.toString());
				})
			]
		});
		view.current = editor;
		if (autoFocus) editor.focus();
		return () => {
			editor.destroy();
			view.current = null;
		};
		// Rebuilt only when its mode changes; `value` syncs below without a rebuild.
	}, [disabled, completions]);

	// External value changes (discard, reset) replace the document; echoes of our own edits are equal and skipped.
	useEffect(() => {
		const editor = view.current;
		if (!editor || editor.state.doc.toString() === value) return;
		editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
	}, [value]);

	return <div ref={host} className={cn('overflow-hidden rounded-md border', className)} />;
}
