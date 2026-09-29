// ANSI SGR parser for build output: reset/bold + 16 foreground colors → dark-terminal Tailwind classes; unknown codes ignored.

export type AnsiSegment = { text: string; classes: string };

const ESC = String.fromCharCode(27);
// SGR sequences (ESC[ ... m) carry the color/style we render.
const SGR = new RegExp(`${ESC}\\[([0-9;]*)m`, 'g');
// Any CSI sequence (ESC[ ... <letter>), stripped wholesale for plain-text output.
const CSI = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g');

const FG: Record<number, string> = {
	30: 'text-gray-500',
	31: 'text-red-400',
	32: 'text-emerald-400',
	33: 'text-amber-400',
	34: 'text-blue-400',
	35: 'text-fuchsia-400',
	36: 'text-cyan-400',
	37: 'text-gray-300',
	90: 'text-gray-500',
	91: 'text-red-300',
	92: 'text-emerald-300',
	93: 'text-amber-300',
	94: 'text-blue-300',
	95: 'text-fuchsia-300',
	96: 'text-cyan-300',
	97: 'text-gray-100'
};

export function stripAnsi(input: string): string {
	return input.replace(CSI, '');
}

export function parseAnsi(line: string): AnsiSegment[] {
	const segments: AnsiSegment[] = [];
	let color = '';
	let bold = false;
	let lastIndex = 0;

	const classesOf = (): string => [color, bold ? 'font-bold' : ''].filter(Boolean).join(' ');
	const push = (text: string): void => {
		if (text.length > 0) segments.push({ text, classes: classesOf() });
	};

	SGR.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = SGR.exec(line)) !== null) {
		push(line.slice(lastIndex, match.index));
		lastIndex = SGR.lastIndex;
		// An empty param list (ESC[m) is shorthand for reset.
		const params = match[1] ?? '';
		const codes = params === '' ? [0] : params.split(';').map(Number);
		for (const code of codes) {
			const fg = FG[code];
			if (code === 0) {
				color = '';
				bold = false;
			} else if (code === 1) {
				bold = true;
			} else if (code === 22) {
				bold = false;
			} else if (fg) {
				color = fg;
			}
			// Backgrounds, default-fg (39), and anything else are intentionally ignored.
		}
	}
	push(line.slice(lastIndex));
	return segments;
}
