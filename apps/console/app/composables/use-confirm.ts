export interface ConfirmOptions {
	title: string;
	description?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	destructive?: boolean;
	// When set, the user must type this exact text to enable the confirm button.
	confirmationText?: string;
}

export interface ConfirmRequest extends ConfirmOptions {
	resolve: (value: boolean) => void;
}

// Shared state read by the single <ConfirmHost> mounted in app.vue.
export function useConfirmRequest() {
	return useState<ConfirmRequest | null>('confirm-request', () => null);
}

// Promise-based confirm: resolves true on confirm, false on cancel/dismiss.
export function useConfirm() {
	const request = useConfirmRequest();
	return (opts: ConfirmOptions) =>
		new Promise<boolean>(resolve => {
			// Settle any still-open request as cancelled before taking over, so its awaiter never hangs.
			request.value?.resolve(false);
			request.value = { ...opts, resolve };
		});
}
