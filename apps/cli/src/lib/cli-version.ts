// CLI + Helm version constants are injected at compile time via Bun's --define flag.
// In `bun run dev` (no --define), they're undefined and we fall back to 'dev' / 'not embedded'.
declare const KUBWAVE_CLI_VERSION: string | undefined;
declare const KUBWAVE_HELM_VERSION: string | undefined;

export function getCliVersion(): string {
	if (typeof KUBWAVE_CLI_VERSION === 'string' && KUBWAVE_CLI_VERSION) return KUBWAVE_CLI_VERSION;
	// Dev override: `bun run dev` has no compile-time version, so KUBWAVE_VERSION lets you target
	// real published image tags (ghcr.io/kubwave/*:<tag>) instead of the bogus 'dev'. Ignored in
	// compiled binaries, where the --define above always wins.
	const envVersion = process.env.KUBWAVE_VERSION?.trim();
	if (envVersion) return envVersion;
	return 'dev';
}

export function getHelmVersion(): string {
	return typeof KUBWAVE_HELM_VERSION === 'string' && KUBWAVE_HELM_VERSION ? KUBWAVE_HELM_VERSION : 'not embedded';
}

export function isDevBuild(): boolean {
	return getCliVersion() === 'dev';
}
