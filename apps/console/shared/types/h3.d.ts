// Augments H3EventContext with accessToken for SSR. Lives in shared/ so both app + server TS projects see it.
declare module 'h3' {
	interface H3EventContext {
		accessToken?: string;
	}
}

export {};
