// Ambient declarations for files we import with Bun's `with { type: 'file' }` attribute.
// At runtime, these resolve to string paths into the embedded bunfs (in compiled binaries)
// or to real on-disk paths (in `bun run` dev mode).

declare module '*/build/embedded/helm' {
	const path: string;
	export default path;
}

declare module '*/build/embedded/chart.tgz' {
	const path: string;
	export default path;
}
