// Returns a fresh object each call so per-test spies don't bleed across files.
// Covers the full set of @clack/prompts exports used anywhere in apps/cli/src.
export function clackStub() {
	return {
		intro: () => {},
		outro: () => {},
		cancel: () => {},
		isCancel: () => false,
		note: () => {},
		log: {
			info: () => {},
			warn: () => {},
			error: () => {},
			success: () => {},
			step: () => {},
			message: () => {}
		},
		spinner: () => ({ start: () => {}, stop: () => {}, message: () => {}, error: () => {} }),
		confirm: async () => true as boolean,
		select: async () => undefined as never,
		text: async () => '',
		password: async () => '',
		multiselect: async () => [] as never[],
		group: async () => ({}) as never,
		tasks: async () => {}
	};
}
