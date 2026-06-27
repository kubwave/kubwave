// CLI + Helm version constants are injected at compile time via Bun's --define flag.
// In `bun run dev` (no --define), they're undefined and we fall back to 'dev' / 'not embedded'.
declare const KUBWAVE_CLI_VERSION: string | undefined;
declare const KUBWAVE_HELM_VERSION: string | undefined;

export function getCliVersion(): string {
	return typeof KUBWAVE_CLI_VERSION === 'string' && KUBWAVE_CLI_VERSION ? KUBWAVE_CLI_VERSION : 'dev';
}

export function getHelmVersion(): string {
	return typeof KUBWAVE_HELM_VERSION === 'string' && KUBWAVE_HELM_VERSION ? KUBWAVE_HELM_VERSION : 'not embedded';
}

export function isDevBuild(): boolean {
	return getCliVersion() === 'dev';
}
