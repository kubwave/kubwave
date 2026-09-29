import { describe, expect, test } from 'bun:test';
import { sectionsFromMdx } from '../lib/search-index';

const page = { path: '/guides/example', title: 'Example guide', group: 'Guides' };

const source = `export const metadata = {
	title: 'Example guide',
	description: 'Shown in the page header.'
};

Intro with **bold** text and a [link](/start/quickstart/).

## Install the \`kubwave\` CLI

<Callout type="note">

Escaped \\{braces\\} stay readable.

</Callout>

\`\`\`sh
## comment, not a heading
kubwave install --domain app.example.com
\`\`\`

### Options

| Flag | Default |
| ---- | ------- |
| \`--ha\` | \`false\` |

## Options

Duplicate heading text.
`;

describe('sectionsFromMdx', () => {
	const sections = sectionsFromMdx(page, source);

	test('starts with the intro section linked to the page itself', () => {
		expect(sections[0]).toEqual({
			href: '/guides/example/',
			page: 'Example guide',
			group: 'Guides',
			title: 'Example guide',
			text: 'Intro with bold text and a link.'
		});
	});

	test('creates one section per h2/h3, ignoring headings inside code blocks', () => {
		expect(sections.map(section => section.title)).toEqual(['Example guide', 'Install the kubwave CLI', 'Options', 'Options']);
	});

	test('links headings with the same slugs rehype-slug renders, including duplicates', () => {
		expect(sections.map(section => section.href)).toEqual([
			'/guides/example/',
			'/guides/example/#install-the-kubwave-cli',
			'/guides/example/#options',
			'/guides/example/#options-1'
		]);
	});

	test('keeps prose as plain text without JSX tags or markdown syntax, and code verbatim', () => {
		expect(sections[1]!.text).toBe('Escaped {braces} stay readable. ## comment, not a heading kubwave install --domain app.example.com');
		expect(sections[2]!.text).toBe('Flag Default --ha false');
	});

	test('keeps a leading step number in headings, as the rendered anchor does', () => {
		const [step] = sectionsFromMdx(page, '## 1. Install the CLI\n\n- Run it.');
		expect(step).toMatchObject({ title: '1. Install the CLI', href: '/guides/example/#1-install-the-cli', text: 'Run it.' });
	});

	test('drops sections without text', () => {
		expect(sectionsFromMdx(page, '## Empty\n\n## Filled\n\nBody.').map(section => section.title)).toEqual(['Filled']);
	});
});
