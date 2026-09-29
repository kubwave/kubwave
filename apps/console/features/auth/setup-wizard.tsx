'use client';

import { apiData } from '@kubwave/api-client';
import { useForm, useStore } from '@tanstack/react-form';
import { ArrowRightIcon, CircleCheckIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { RegistryFields } from '@/features/platform/registry-fields';
import { registryDraftFrom, registryErrors, registryPayload, type RegistryDraft } from '@/features/platform/registry-model';
import { useRegistrySettings } from '@/features/platform/use-registry-settings';
import { errorCode } from '@/lib/api/api-error';
import { getBrowserApi } from '@/lib/api/browser-api';
import { cn } from '@/lib/utils';
import { AuthCard, AuthNotice, FormError, FormField, PasswordStrength, SubmitButton } from './auth-kit';
import { useSession } from './session-provider';

const steps = ['Admin account', 'Build registry'];

function Stepper({ step }: { step: number }) {
	const total = steps.length;
	const current = Math.min(step, total - 1);
	return (
		<div
			role="progressbar"
			aria-valuemin={1}
			aria-valuemax={total}
			aria-valuenow={current + 1}
			aria-valuetext={`${steps[current]}, step ${current + 1} of ${total}`}
			className="mb-6 flex gap-1.5"
		>
			{steps.map((label, index) => (
				<span key={label} className={cn('h-1 flex-1 rounded-full transition-colors', index <= current ? 'bg-primary-text' : 'bg-muted')} />
			))}
		</div>
	);
}

const accountSchema = z.object({
	name: z.string().trim().min(1, 'Enter a name.'),
	email: z.string().min(1, 'Enter an email.').email('Enter a valid email address.'),
	password: z.string().min(8, 'Use at least 8 characters.')
});

function AccountStep() {
	const { signIn } = useSession();
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: { name: '', email: '', password: '' },
		validators: { onSubmit: accountSchema },
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const { accessToken } = await apiData(getBrowserApi().setup.initialize.post(value));
				await signIn(accessToken);
			} catch (err) {
				setError(errorCode(err) === 'already_initialized' ? 'This platform has already been set up.' : 'Something went wrong — please try again.');
			}
		}
	});
	const password = useStore(form.store, state => state.values.password);

	return (
		<form
			noValidate
			onSubmit={event => {
				event.preventDefault();
				void form.handleSubmit();
			}}
			className="grid gap-4"
		>
			<div className="mb-2 space-y-1.5">
				<h1 className="text-xl font-semibold tracking-tight">Create the admin account</h1>
				<p className="text-sm text-muted-foreground">This account can manage the cluster, platform settings and every team.</p>
			</div>
			<form.Field name="name">{field => <FormField field={field} label="Name" autoComplete="name" placeholder="Admin" autoFocus />}</form.Field>
			<form.Field name="email">
				{field => <FormField field={field} label="Email" type="email" autoComplete="email" placeholder="you@example.com" />}
			</form.Field>
			<form.Field name="password">
				{field => (
					<FormField
						field={field}
						label="Password"
						type="password"
						autoComplete="new-password"
						placeholder="At least 8 characters"
						hint={<PasswordStrength value={password} />}
					/>
				)}
			</form.Field>
			<FormError message={error} />
			<form.Subscribe selector={state => state.isSubmitting}>
				{submitting => (
					<SubmitButton pending={submitting} className="mt-2">
						Continue
						<ArrowRightIcon />
					</SubmitButton>
				)}
			</form.Subscribe>
		</form>
	);
}

function RegistryStep({ onReady }: { onReady: () => void }) {
	const { settings, save } = useRegistrySettings();
	const [draft, setDraft] = useState<RegistryDraft | null>(null);
	const [showErrors, setShowErrors] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const current = settings.data;
	const applyStatus = current?.applyStatus;

	useEffect(() => {
		if (current && !draft) setDraft(registryDraftFrom(current));
	}, [current, draft]);
	useEffect(() => {
		if (applyStatus === 'applied') onReady();
		if (applyStatus === 'failed') setError(current?.lastError ?? 'Registry apply failed.');
	}, [applyStatus, current?.lastError, onReady]);

	if (applyStatus === 'pending' || applyStatus === 'applying')
		return (
			<div aria-live="polite" className="space-y-2">
				<div className="flex items-center gap-2.5">
					<LoaderCircleIcon className="size-4 animate-spin text-primary-text" />
					<h1 className="font-medium">Applying registry configuration…</h1>
				</div>
				<p className="text-sm text-muted-foreground">kubwave rolls out the registry and the build workers. This can take a few minutes.</p>
			</div>
		);
	if (!draft) return <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />;

	const errors = registryErrors(draft, current?.hasPassword ?? false);
	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		setShowErrors(true);
		if (Object.keys(errors).length > 0) return;
		setError(null);
		try {
			await save.mutateAsync(registryPayload(draft));
			setDraft({ ...draft, password: '' });
		} catch {
			setError('Could not save registry settings.');
		}
	};

	return (
		<form noValidate onSubmit={submit} className="grid gap-5">
			<div className="space-y-1.5">
				<h1 className="text-xl font-semibold tracking-tight">Configure the build registry</h1>
				<p className="text-sm text-muted-foreground">kubwave builds images from your repositories and pushes them here before rolling them out.</p>
			</div>
			<RegistryFields draft={draft} errors={showErrors ? errors : {}} hasStoredPassword={current?.hasPassword ?? false} onChange={setDraft} />
			<FormError message={error} />
			<div className="flex justify-end pt-1">
				<SubmitButton pending={save.isPending} className="w-auto">
					Save registry
				</SubmitButton>
			</div>
		</form>
	);
}

export function SetupWizard() {
	const { user } = useSession();
	const [ready, setReady] = useState(false);
	const step = ready ? 2 : user ? 1 : 0;

	return (
		<AuthCard className="max-w-lg" tagline="First-run setup · this only happens once per installation.">
			<Stepper step={step} />
			{step === 0 && <AccountStep />}
			{step === 1 && <RegistryStep onReady={() => setReady(true)} />}
			{step === 2 && (
				<AuthNotice
					icon={<CircleCheckIcon />}
					tone="success"
					title="kubwave is ready"
					description="Your admin account and build registry are set up. Next, create a project and deploy your first service."
				>
					{/* A full load, so the server renders the console with the finished setup. */}
					<Button onClick={() => window.location.assign('/')}>
						Open console
						<ArrowRightIcon />
					</Button>
				</AuthNotice>
			)}
		</AuthCard>
	);
}
