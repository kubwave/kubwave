// Bun bundles `.yaml` imported with `{ type: 'text' }` as a string; this tells tsc the same.
declare module '*.yaml' {
	const content: string;
	export default content;
}
