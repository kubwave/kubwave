'use client';

import type { SshKeyDto } from '@kubwave/api-client';
import { useForm } from '@tanstack/react-form';
import { CheckCircle2Icon, KeyRoundIcon, SparklesIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';
import { useConfirm } from '@/components/confirm-provider';
import { CopyButton } from '@/components/copy-button';
import { FormError, FormField, SubmitButton } from '@/components/form-field';
import { CodeBlock, EmptyRow, ListCard, LoadError, RowIcon, WithTooltip } from '@/components/settings/parts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { errorCode } from '@/lib/api/api-error';
import type { SshKey } from '@/lib/api/types';
import { formatRelative } from '@/lib/format';
import { fieldError } from '@/lib/forms';
import { sshKeyCreateError, sshKeyDeleteErrorMessage } from './errors';
import { sshKeyInput, type SshKeyDraft } from './model';
import { useSshKeyMutations } from './use-team-settings';

export function SshKeysSection({
	teamId,
	isOwner,
	keys,
	loading,
	onRetry
}: {
	teamId: string;
	isOwner: boolean;
	keys: SshKey[] | undefined;
	loading: boolean;
	// Set when the key list failed to load.
	onRetry?: () => void;
}) {
	const confirm = useConfirm();
	const { remove } = useSshKeyMutations(teamId);
	const [adding, setAdding] = useState(false);
	const list = keys ?? [];

	const deleteKey = async (key: SshKey) => {
		const confirmed = await confirm({
			title: 'Delete SSH key',
			description: `Delete “${key.name}”? Services that clone with this key will fail on their next build. This cannot be undone.`,
			confirmLabel: 'Delete key',
			destructive: true
		});
		if (!confirmed) return;
		try {
			await remove.mutateAsync(key.id);
			toast.success('SSH key deleted', { description: `${key.name} was removed.` });
		} catch (err) {
			toast.error('Could not delete key', { description: sshKeyDeleteErrorMessage(errorCode(err)) });
		}
	};

	return (
		<>
			<ListCard
				title="SSH keys"
				description="Deploy keys for cloning private Git repositories over SSH. Add the public key to your Git host with read access."
				action={
					<WithTooltip tip={!isOwner && 'Only owners can add SSH keys.'}>
						<Button size="sm" disabled={!isOwner} onClick={() => setAdding(true)}>
							<KeyRoundIcon />
							Add key
						</Button>
					</WithTooltip>
				}
			>
				{loading &&
					[0, 1].map(i => (
						<li key={i} className="flex items-center gap-3 px-5 py-3.5">
							<Skeleton className="size-5 rounded-md" />
							<div className="grid flex-1 gap-1.5">
								<Skeleton className="h-3.5 w-32" />
								<Skeleton className="h-3 w-64" />
							</div>
						</li>
					))}
				{onRetry && (
					<li>
						<LoadError what="the SSH keys" onRetry={onRetry} />
					</li>
				)}
				{!loading && !onRetry && list.length === 0 && (
					<EmptyRow
						icon={KeyRoundIcon}
						title="No SSH keys yet"
						description="Generate a key pair in kubwave, or upload a private key you already use."
					/>
				)}
				{list.map(key => (
					<li key={key.id} className="flex items-center gap-3 px-5 py-3.5">
						<RowIcon icon={KeyRoundIcon} />
						<div className="min-w-0 flex-1 space-y-1">
							<div className="flex flex-wrap items-center gap-1.5">
								<span className="text-sm font-medium">{key.name}</span>
								<Badge variant="outline" className="px-1.5 font-mono text-[10px]">
									{key.keyType}
								</Badge>
								<Badge variant="secondary" className="px-1.5 text-[10px]">
									{key.source === 'generated' ? 'Generated' : 'Uploaded'}
								</Badge>
							</div>
							<p className="flex min-w-0 gap-1.5 text-xs text-muted-foreground">
								<span className="truncate font-mono">{key.fingerprint}</span>
								<span className="shrink-0">· added {formatRelative(key.createdAt)}</span>
							</p>
						</div>
						<CopyButton value={key.publicKey} label={`Copy public key of ${key.name}`} />
						{isOwner && (
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label={`Delete ${key.name}`}
								disabled={remove.isPending && remove.variables === key.id}
								className="text-muted-foreground hover:text-destructive"
								onClick={() => void deleteKey(key)}
							>
								<Trash2Icon />
							</Button>
						)}
					</li>
				))}
			</ListCard>
			<AddKeyDialog teamId={teamId} open={adding} onOpenChange={setAdding} />
		</>
	);
}

const keySchema = z
	.object({
		mode: z.enum(['generate', 'upload']),
		name: z.string().trim().min(1, 'Enter a name.').max(100, 'Name is too long.'),
		privateKey: z.string()
	})
	.superRefine((value, ctx) => {
		if (value.mode === 'upload' && !value.privateKey.trim()) ctx.addIssue({ code: 'custom', path: ['privateKey'], message: 'Paste a private key.' });
	});

function AddKeyDialog({ teamId, open, onOpenChange }: { teamId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
	const { create } = useSshKeyMutations(teamId);
	const [error, setError] = useState<string | null>(null);
	const [generated, setGenerated] = useState<SshKeyDto | null>(null);
	const form = useForm({
		defaultValues: { mode: 'generate', name: '', privateKey: '' } as SshKeyDraft,
		validators: { onSubmit: keySchema },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const key = await create.mutateAsync(sshKeyInput(value));
				if (value.mode === 'generate') return setGenerated(key);
				toast.success('SSH key added', { description: `${key.name} is ready to use as a deploy key.` });
				close();
			} catch (err) {
				const { title, description } = sshKeyCreateError(errorCode(err));
				setError(`${title}. ${description}`);
			}
		}
	});
	const close = () => {
		form.reset();
		setError(null);
		setGenerated(null);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={next => (next ? onOpenChange(true) : close())}>
			<DialogContent className="sm:max-w-lg">
				{generated ? (
					<>
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<CheckCircle2Icon className="size-5 text-success" />
								Key generated
							</DialogTitle>
							<DialogDescription>
								Add this public key as a read-only deploy key on your Git host. The private key is stored encrypted and never leaves the platform.
							</DialogDescription>
						</DialogHeader>
						<div className="grid gap-2">
							<div className="flex items-center justify-between gap-2 text-xs">
								<span className="font-medium">Public key</span>
								<span className="truncate font-mono text-muted-foreground">{generated.fingerprint}</span>
							</div>
							<CodeBlock value={generated.publicKey} label="Copy public key" wrap />
						</div>
						<DialogFooter>
							<Button onClick={close}>Done</Button>
						</DialogFooter>
					</>
				) : (
					<form
						noValidate
						onSubmit={event => {
							event.preventDefault();
							void form.handleSubmit();
						}}
						className="grid gap-4"
					>
						<DialogHeader>
							<DialogTitle>Add SSH key</DialogTitle>
							<DialogDescription>Generate a fresh key pair, or upload a private key you already use as a deploy key.</DialogDescription>
						</DialogHeader>
						<form.Field name="mode">
							{field => (
								<Tabs value={field.state.value} onValueChange={mode => field.handleChange(mode as SshKeyDraft['mode'])}>
									<TabsList className="w-full">
										<TabsTrigger value="generate">
											<SparklesIcon />
											Generate
										</TabsTrigger>
										<TabsTrigger value="upload">
											<UploadIcon />
											Upload
										</TabsTrigger>
									</TabsList>
								</Tabs>
							)}
						</form.Field>
						<form.Field name="name">
							{field => (
								<FormField
									field={field}
									label="Name"
									autoFocus
									autoComplete="off"
									placeholder="gitea-deploy"
									hint={<p className="text-xs text-muted-foreground">Shown when picking a key for a private repository service.</p>}
								/>
							)}
						</form.Field>
						<form.Subscribe selector={state => state.values.mode}>
							{mode =>
								mode === 'upload' ? (
									<form.Field name="privateKey">
										{field => {
											const message = fieldError(field.state.meta);
											return (
												<div className="grid gap-2">
													<Label htmlFor="ssh-private-key">Private key</Label>
													<Textarea
														id="ssh-private-key"
														spellCheck={false}
														value={field.state.value}
														onChange={event => field.handleChange(event.target.value)}
														onBlur={field.handleBlur}
														aria-invalid={message ? true : undefined}
														placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----'}
														className="max-h-48 min-h-32 font-mono text-xs"
													/>
													<p className={message ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
														{message ?? 'OpenSSH or PEM private key. Passphrase-protected keys are not accepted.'}
													</p>
												</div>
											);
										}}
									</form.Field>
								) : (
									<p className="rounded-md border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
										kubwave generates an <span className="font-mono text-foreground">ed25519</span> key pair and stores the private key encrypted. You
										get the public key to paste into your Git host.
									</p>
								)
							}
						</form.Subscribe>
						<FormError message={error} />
						<DialogFooter>
							<Button type="button" variant="outline" onClick={close}>
								Cancel
							</Button>
							<form.Subscribe selector={state => [state.isSubmitting, state.values.mode] as const}>
								{([submitting, mode]) => (
									<SubmitButton pending={submitting} className="w-auto">
										{mode === 'generate' ? 'Generate key' : 'Upload key'}
									</SubmitButton>
								)}
							</form.Subscribe>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
