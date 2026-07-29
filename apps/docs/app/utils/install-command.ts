const BASE_COMMAND = 'curl -fsSL https://get.kubwave.com | bash';

// The docs build is channel-scoped (see `docsChannel` in nuxt.config.ts), so the install
// command has to follow it — the stable site must not hand readers a `--channel preview`.
export function buildInstallCommand(channel: string): string {
	return channel === 'next' ? `${BASE_COMMAND} -s -- --channel preview` : BASE_COMMAND;
}

export function useInstallCommand(): ComputedRef<string> {
	const config = useRuntimeConfig();
	return computed(() => buildInstallCommand(String(config.public.docsChannel)));
}
