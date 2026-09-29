'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type ConfirmOptions = {
	title: string;
	description?: React.ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	destructive?: boolean;
	// When set, the user must type this exact text to enable the confirm button.
	confirmationText?: string;
};

type Request = ConfirmOptions & { resolve: (confirmed: boolean) => void };
type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

// Promise-based confirm dialog: resolves true on confirm, false on cancel or dismiss.
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
	const [request, setRequest] = useState<Request | null>(null);
	const [typed, setTyped] = useState('');

	const confirm = useCallback<Confirm>(
		options =>
			new Promise<boolean>(resolve => {
				setTyped('');
				setRequest(previous => {
					// A still-open request settles as cancelled, so its awaiter never hangs.
					previous?.resolve(false);
					return { ...options, resolve };
				});
			}),
		[]
	);

	const settle = (confirmed: boolean) => {
		request?.resolve(confirmed);
		setRequest(null);
	};
	const canConfirm = !request?.confirmationText || typed === request.confirmationText;

	return (
		<ConfirmContext value={confirm}>
			{children}
			<Dialog open={request !== null} onOpenChange={open => !open && settle(false)}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>{request?.title}</DialogTitle>
						{request?.description && <DialogDescription>{request.description}</DialogDescription>}
					</DialogHeader>
					{request?.confirmationText && (
						<div className="space-y-2">
							<Label htmlFor="confirm-text">
								Type <span className="font-mono font-semibold text-foreground">{request.confirmationText}</span> to confirm
							</Label>
							<Input
								id="confirm-text"
								value={typed}
								autoComplete="off"
								autoFocus
								onChange={event => setTyped(event.target.value)}
								onKeyDown={event => event.key === 'Enter' && canConfirm && settle(true)}
							/>
						</div>
					)}
					<DialogFooter>
						<Button variant="outline" onClick={() => settle(false)}>
							{request?.cancelLabel ?? 'Cancel'}
						</Button>
						<Button variant={request?.destructive ? 'destructive' : 'default'} disabled={!canConfirm} onClick={() => settle(true)}>
							{request?.confirmLabel ?? 'Confirm'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</ConfirmContext>
	);
}

export function useConfirm(): Confirm {
	const confirm = useContext(ConfirmContext);
	if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider>');
	return confirm;
}
