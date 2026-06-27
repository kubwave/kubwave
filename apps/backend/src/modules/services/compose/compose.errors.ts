export class ComposeParseError extends Error {
	constructor(public readonly issues: string[]) {
		super(issues.join('\n'));
		this.name = 'ComposeParseError';
	}
}
