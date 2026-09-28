'use client';

import { BotIcon, LogOutIcon, MonitorIcon, MonitorSmartphoneIcon, MoonIcon, PaletteIcon, SmartphoneIcon, SunIcon, UserIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field, PasswordStrength } from '@/components/auth/auth-kit';
import { PageHeader } from '@/components/page-header';
import { type Section, SettingsCard, SettingsLayout } from '@/components/settings-layout';
import { UserAvatar } from '@/components/shell/user-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { currentUser } from '@/lib/mock';
import { mcpAccess, sessions as initialSessions } from '@/lib/mock-settings';
import { McpAccess } from './mcp-access';
import { ListCard, RowIcon, useHashSection } from './parts';
import { SaveBar, useDraft } from './save-bar';

const sectionIds = ['profile', 'appearance', 'ai-access', 'sessions'];

const sections: Section[] = [
	{ id: 'profile', label: 'Profile', icon: UserIcon },
	{ id: 'appearance', label: 'Appearance', icon: PaletteIcon },
	{ id: 'ai-access', label: 'AI access (MCP)', icon: BotIcon },
	{ id: 'sessions', label: 'Sessions', icon: MonitorSmartphoneIcon }
];

const initialsOf = (name: string) =>
	name
		.split(/\s+/)
		.filter(Boolean)
		.map(s => s[0])
		.join('')
		.slice(0, 2)
		.toUpperCase() || '?';

export function AccountSettings() {
	const [section, setSection] = useHashSection(sectionIds);
	const profile = useDraft({ name: currentUser.name, email: currentUser.email });
	const [access, setAccess] = useState(mcpAccess);
	const [sessions, setSessions] = useState(initialSessions);

	const save = () => {
		if (!profile.draft.name.trim() || !/^\S+@\S+\.\S+$/.test(profile.draft.email)) return toast.error('Enter a name and a valid email address');
		const emailChanged = profile.draft.email !== profile.saved.email;
		profile.save();
		toast.success('Profile updated', emailChanged ? { description: `Confirm the change via the link sent to ${profile.draft.email}.` } : undefined);
	};

	return (
		<div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8">
			<PageHeader
				eyebrow="Account"
				title={
					<span className="flex items-center gap-3">
						<UserAvatar initials={initialsOf(profile.saved.name)} className="size-7" />
						{profile.saved.name}
					</span>
				}
				description={profile.saved.email}
				actions={
					currentUser.isAdmin && (
						<Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary-text">
							Instance admin
						</Badge>
					)
				}
			/>
			<SettingsLayout sections={sections} active={section} onChange={setSection}>
				{section === 'profile' && (
					<>
						<SettingsCard
							title="Profile"
							description="How you appear to teammates in member lists and deployment history."
							footer={
								<Button size="sm" disabled={!profile.changes} onClick={save}>
									Save
								</Button>
							}
						>
							<div className="flex flex-col gap-6 sm:flex-row sm:items-start">
								<div className="flex flex-col items-center gap-2">
									<UserAvatar initials={initialsOf(profile.draft.name)} className="size-16 [&_[data-slot=avatar-fallback]]:text-lg" />
									<span className="text-[11px] text-muted-foreground">From your initials</span>
								</div>
								<div className="grid flex-1 gap-4 sm:grid-cols-2">
									<Field
										id="profile-name"
										label="Name"
										autoComplete="name"
										value={profile.draft.name}
										onChange={e => profile.set('name', e.target.value)}
									/>
									<Field
										id="profile-email"
										label="Email"
										type="email"
										autoComplete="email"
										value={profile.draft.email}
										onChange={e => profile.set('email', e.target.value)}
										hint={
											profile.draft.email !== profile.saved.email && (
												<p className="text-xs text-muted-foreground">We send a confirmation link to the new address.</p>
											)
										}
									/>
								</div>
							</div>
						</SettingsCard>
						<PasswordCard />
					</>
				)}
				{section === 'appearance' && <Appearance />}
				{section === 'ai-access' && <McpAccess entries={access} setEntries={setAccess} />}
				{section === 'sessions' && (
					<ListCard
						title="Sessions"
						description="Devices currently signed in to your account."
						action={
							<Button
								size="sm"
								variant="outline"
								disabled={sessions.length === 1}
								onClick={() => {
									setSessions(s => s.filter(x => x.current));
									toast.success('Signed out of all other sessions');
								}}
							>
								<LogOutIcon />
								Sign out other sessions
							</Button>
						}
					>
						{sessions.map(s => (
							<li key={s.id} className="flex items-center gap-3 px-5 py-3">
								<RowIcon icon={s.device === 'mobile' ? SmartphoneIcon : MonitorIcon} />
								<div className="min-w-0 flex-1">
									<p className="flex flex-wrap items-center gap-2 text-sm font-medium">
										{s.client}
										{s.current && (
											<Badge variant="outline" className="border-success/30 bg-success/10 px-1.5 text-[10px] text-success">
												This device
											</Badge>
										)}
									</p>
									<p className="text-xs text-muted-foreground">
										{s.location} · <span className="font-mono">{s.ip}</span> · {s.lastActive}
									</p>
								</div>
								{!s.current && (
									<Button
										variant="ghost"
										size="sm"
										className="text-muted-foreground"
										onClick={() => {
											setSessions(list => list.filter(x => x.id !== s.id));
											toast.success(`Signed out ${s.client}`);
										}}
									>
										Sign out
									</Button>
								)}
							</li>
						))}
					</ListCard>
				)}
			</SettingsLayout>
			<SaveBar changes={profile.changes} onDiscard={profile.discard} onSave={save} />
		</div>
	);
}

function PasswordCard() {
	const [current, setCurrent] = useState('');
	const [next, setNext] = useState('');
	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		setCurrent('');
		setNext('');
		toast.success('Password updated', { description: 'This session stays signed in.' });
	};
	return (
		<form onSubmit={submit}>
			<SettingsCard
				title="Password"
				description="Use at least 8 characters. A mix of cases, digits or symbols makes it stronger."
				footer={
					<Button type="submit" size="sm" disabled={!current || next.length < 8}>
						Update password
					</Button>
				}
			>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field
						id="current-password"
						label="Current password"
						type="password"
						autoComplete="current-password"
						value={current}
						onChange={e => setCurrent(e.target.value)}
					/>
					<Field
						id="new-password"
						label="New password"
						type="password"
						autoComplete="new-password"
						value={next}
						onChange={e => setNext(e.target.value)}
						hint={<PasswordStrength value={next} />}
					/>
				</div>
			</SettingsCard>
		</form>
	);
}

const themes = [
	{ value: 'light', label: 'Light', icon: SunIcon },
	{ value: 'dark', label: 'Dark', icon: MoonIcon },
	{ value: 'system', label: 'System', icon: MonitorIcon }
] as const;

const palettes = {
	light: { bg: '#fafafa', card: '#ffffff', border: '#e4e4e7', muted: '#e4e4e7', text: '#a1a1aa', primary: '#18181b' },
	dark: { bg: '#0b0c0e', card: '#131417', border: '#23252b', muted: '#26282e', text: '#4a4c55', primary: '#ececef' }
};

function MiniUi({ mode }: { mode: 'light' | 'dark' }) {
	const c = palettes[mode];
	return (
		<div className="flex h-full flex-col" style={{ background: c.bg }}>
			<div className="flex h-4 shrink-0 items-center gap-1 border-b px-2" style={{ borderColor: c.border }}>
				<span className="size-1.5 rounded-full" style={{ background: c.primary }} />
				<span className="h-1 w-6 rounded-full" style={{ background: c.muted }} />
				<span className="ml-auto size-2 rounded-full" style={{ background: c.muted }} />
			</div>
			<div className="grid flex-1 grid-cols-2 gap-1.5 p-2">
				{['#22c55e', '#f59e0b', '#22c55e', '#22c55e'].map((dot, i) => (
					<div key={i} className="space-y-1 rounded-sm border p-1.5" style={{ background: c.card, borderColor: c.border }}>
						<div className="flex items-center gap-1">
							<span className="size-1 rounded-full" style={{ background: dot }} />
							<span className="h-1 w-8 rounded-full" style={{ background: c.text }} />
						</div>
						<span className="block h-1 w-5 rounded-full" style={{ background: c.muted }} />
					</div>
				))}
			</div>
		</div>
	);
}

function Appearance() {
	const { theme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	return (
		<SettingsCard title="Theme" description="Choose how kubwave looks on this device. System follows your operating system setting.">
			<RadioGroup value={(mounted && theme) || ''} onValueChange={setTheme} aria-label="Theme" className="grid gap-4 sm:grid-cols-3">
				{themes.map(t => (
					<label
						key={t.value}
						htmlFor={`theme-${t.value}`}
						className="cursor-pointer rounded-lg border bg-background p-1.5 transition-colors hover:border-foreground/20 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-2 has-[[data-state=checked]]:ring-primary/20"
					>
						<div aria-hidden className="relative aspect-[16/10] overflow-hidden rounded-md border">
							{t.value === 'system' ? (
								<>
									<MiniUi mode="light" />
									<div className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
										<MiniUi mode="dark" />
									</div>
								</>
							) : (
								<MiniUi mode={t.value} />
							)}
						</div>
						<div className="flex items-center gap-2 px-1.5 pt-2.5 pb-1">
							<RadioGroupItem value={t.value} id={`theme-${t.value}`} />
							<t.icon className="size-3.5 text-muted-foreground" />
							<span className="text-sm font-medium">{t.label}</span>
						</div>
					</label>
				))}
			</RadioGroup>
		</SettingsCard>
	);
}
