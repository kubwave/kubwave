'use client';

import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, CircleCheckIcon, GlobeIcon, LoaderCircleIcon, ServerIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthCard, AuthNotice, Field, PasswordStrength } from '@/components/auth/auth-kit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const steps = ['Admin account', 'Build registry'];
const applySteps = ['Validating registry settings', 'Writing credentials to kubwave-system', 'Rolling out build workers', 'Verifying push access'];
const STEP_MS = 600;

const registryOptions = [
	{
		value: 'managed',
		icon: ServerIcon,
		title: 'Platform-managed',
		description: 'An in-cluster registry, provisioned and wired up for you.',
		recommended: true
	},
	{ value: 'external', icon: GlobeIcon, title: 'External', description: 'Push to your own registry: GHCR, Harbor, ECR, Docker Hub.' }
];

function Stepper({ step }: { step: number }) {
	return (
		<ol className="-mx-6 -mt-6 mb-6 flex items-center gap-3 border-b bg-muted/30 px-6 py-4 sm:-mx-7 sm:-mt-7 sm:px-7">
			{steps.map((label, i) => (
				<li key={label} aria-current={i === step ? 'step' : undefined} className="flex flex-1 items-center gap-2.5 last:flex-none">
					<span
						className={cn(
							'flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-medium transition-colors',
							i < step
								? 'border-primary bg-primary text-primary-foreground'
								: i === step
									? 'border-primary text-primary-text'
									: 'text-muted-foreground'
						)}
					>
						{i < step ? <CheckIcon className="size-3.5" /> : i + 1}
					</span>
					<span className={cn('text-sm whitespace-nowrap', i === step ? 'font-medium' : 'text-muted-foreground')}>{label}</span>
					{i < steps.length - 1 && <span className={cn('h-px min-w-6 flex-1 bg-border transition-colors', i < step && 'bg-primary')} />}
				</li>
			))}
		</ol>
	);
}

export default function SetupPage() {
	const router = useRouter();
	const [step, setStep] = useState(0);
	const [email, setEmail] = useState('alex@acme.dev');
	const [password, setPassword] = useState('');
	const [mode, setMode] = useState('managed');
	const [endpoint, setEndpoint] = useState('');
	const [progress, setProgress] = useState<number | null>(null);

	const save = (e: React.FormEvent) => {
		e.preventDefault();
		setProgress(0);
		applySteps.forEach((_, i) => setTimeout(() => setProgress(i + 1), STEP_MS * (i + 1)));
		setTimeout(() => setStep(2), STEP_MS * applySteps.length + 400);
	};

	return (
		<AuthCard className="max-w-lg" tagline="First-run setup · this only happens once per installation.">
			<Stepper step={step} />

			{step === 0 && (
				<form
					onSubmit={e => {
						e.preventDefault();
						setStep(1);
					}}
					className="grid gap-4"
				>
					<div className="mb-2 space-y-1.5">
						<h1 className="text-xl font-semibold tracking-tight">Create the admin account</h1>
						<p className="text-sm text-muted-foreground">This account can manage the cluster, platform settings and every team.</p>
					</div>
					<Field id="name" label="Name" autoComplete="name" defaultValue="Alex Morgan" required />
					<Field id="email" label="Email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
					<Field
						id="password"
						label="Password"
						type="password"
						autoComplete="new-password"
						minLength={8}
						required
						autoFocus
						value={password}
						onChange={e => setPassword(e.target.value)}
						hint={<PasswordStrength value={password} />}
					/>
					<Button type="submit" className="mt-2 w-full">
						Continue
						<ArrowRightIcon />
					</Button>
				</form>
			)}

			{step === 1 && progress === null && (
				<form onSubmit={save} className="grid gap-5">
					<div className="space-y-1.5">
						<h1 className="text-xl font-semibold tracking-tight">Configure the build registry</h1>
						<p className="text-sm text-muted-foreground">
							kubwave builds images from your repositories and pushes them here before rolling them out.
						</p>
					</div>
					<RadioGroup value={mode} onValueChange={setMode} className="grid gap-3 sm:grid-cols-2" aria-label="Registry type">
						{registryOptions.map(o => (
							<Label
								key={o.value}
								htmlFor={`registry-${o.value}`}
								className="flex cursor-pointer flex-col items-start gap-2 rounded-lg border p-3.5 transition-colors hover:bg-accent/40 has-[[data-state=checked]]:border-primary/60 has-[[data-state=checked]]:bg-primary/5"
							>
								<div className="flex w-full items-center justify-between">
									<span className="flex size-7 items-center justify-center rounded-md border bg-background">
										<o.icon className="size-3.5 text-muted-foreground" />
									</span>
									<RadioGroupItem value={o.value} id={`registry-${o.value}`} />
								</div>
								<span className="flex items-center gap-2">
									{o.title}
									{o.recommended && (
										<Badge variant="outline" className="border-primary/30 px-1.5 text-[10px] text-primary-text">
											Recommended
										</Badge>
									)}
								</span>
								<span className="text-xs leading-relaxed font-normal text-muted-foreground">{o.description}</span>
							</Label>
						))}
					</RadioGroup>

					{mode === 'managed' ? (
						<div className="rounded-lg border border-dashed px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
							Images are stored at <code className="font-mono text-foreground">registry.kubwave-system.svc:5000</code> on a 20Gi volume. You can
							switch to an external registry later in platform settings.
						</div>
					) : (
						<div className="grid gap-4">
							<Field
								id="endpoint"
								label="Endpoint"
								placeholder="ghcr.io/acme"
								className="font-mono"
								required
								value={endpoint}
								onChange={e => setEndpoint(e.target.value)}
							/>
							<div className="grid gap-4 sm:grid-cols-2">
								<Field id="username" label="Username" autoComplete="off" placeholder="kubwave-bot" required />
								<Field id="token" label="Password or token" type="password" autoComplete="off" required />
							</div>
							<div className="flex items-center justify-between gap-4 rounded-lg border px-3.5 py-3">
								<div className="space-y-1">
									<Label htmlFor="insecure">Insecure (HTTP)</Label>
									<p className="text-xs text-muted-foreground">Skip TLS. Only for registries on a trusted private network.</p>
								</div>
								<Switch id="insecure" />
							</div>
						</div>
					)}

					<div className="flex items-center justify-between gap-2 pt-1">
						<Button type="button" variant="ghost" onClick={() => setStep(0)}>
							<ArrowLeftIcon />
							Back
						</Button>
						<Button type="submit">Save registry</Button>
					</div>
				</form>
			)}

			{step === 1 && progress !== null && (
				<div className="animate-in" aria-live="polite">
					<div className="mb-4 flex items-center gap-2.5">
						<LoaderCircleIcon className="size-4 animate-spin text-primary-text" />
						<h1 className="font-medium">Applying registry configuration…</h1>
					</div>
					<ol className="space-y-2 rounded-lg border bg-muted/40 p-4 font-mono text-xs">
						{applySteps.slice(0, progress + 1).map((line, i) => (
							<li key={line} className="flex items-center gap-2.5">
								{i < progress ? (
									<CheckIcon className="size-3.5 text-success" />
								) : (
									<LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground" />
								)}
								<span className={i < progress ? 'text-muted-foreground' : 'text-foreground'}>{line}</span>
							</li>
						))}
					</ol>
				</div>
			)}

			{step === 2 && (
				<AuthNotice
					icon={<CircleCheckIcon />}
					tone="success"
					title="kubwave is ready"
					description="Your admin account and build registry are set up. Next, connect a Git provider and deploy your first service."
				>
					<dl className="mb-2 divide-y rounded-lg border text-left text-sm">
						<div className="flex justify-between gap-4 px-3.5 py-2.5">
							<dt className="text-muted-foreground">Admin</dt>
							<dd className="truncate font-mono text-xs leading-5">{email}</dd>
						</div>
						<div className="flex justify-between gap-4 px-3.5 py-2.5">
							<dt className="text-muted-foreground">Registry</dt>
							<dd className="truncate font-mono text-xs leading-5">{mode === 'managed' ? 'platform-managed' : endpoint}</dd>
						</div>
					</dl>
					<Button onClick={() => router.push('/')}>
						Open console
						<ArrowRightIcon />
					</Button>
				</AuthNotice>
			)}
		</AuthCard>
	);
}
