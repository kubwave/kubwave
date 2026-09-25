const LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function unescapeDoubleQuoted(value: string): string {
	return value.replace(/\\([nrt"\\])/g, (_match, ch: string) => ({ n: '\n', r: '\r', t: '\t' })[ch] ?? ch);
}

// Parses .env text: comments, `export`, unquoted values with trailing `# comments`, and single/double-quoted values spanning lines. Last key wins.
export function parseDotenv(text: string): Array<{ key: string; value: string }> {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	const entries = new Map<string, string>();

	for (let i = 0; i < lines.length; i++) {
		const match = LINE_RE.exec(lines[i]!);
		if (!match) continue;
		const key = match[1]!;
		let rest = match[2]!;
		const quote = rest[0];

		if (quote === '"' || quote === "'") {
			rest = rest.slice(1);
			const closing = quote === '"' ? /(?<!\\)"/ : /'/;
			while (!closing.test(rest) && i + 1 < lines.length) rest += `\n${lines[++i]}`;
			const end = rest.search(closing);
			const raw = end === -1 ? rest : rest.slice(0, end);
			entries.set(key, quote === '"' ? unescapeDoubleQuoted(raw) : raw);
		} else {
			entries.set(key, rest.replace(/\s+#.*$/, '').trim());
		}
	}

	return [...entries].map(([key, value]) => ({ key, value }));
}
