'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ConfirmDelete({
	name,
	title,
	description,
	onConfirm,
	children
}: {
	name: string;
	title: string;
	description: string;
	onConfirm: () => void;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const [typed, setTyped] = useState('');
	return (
		<Dialog
			open={open}
			onOpenChange={o => {
				setOpen(o);
				setTyped('');
			}}
		>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<div className="space-y-2">
					<Label htmlFor="confirm-name">
						Type <span className="font-mono font-semibold text-foreground">{name}</span> to confirm
					</Label>
					<Input id="confirm-name" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" />
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						disabled={typed !== name}
						onClick={() => {
							setOpen(false);
							onConfirm();
						}}
					>
						Delete
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
