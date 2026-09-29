'use client';

import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { SettingsCard } from '@/components/settings-layout';
import { InfoItem, useHashSection } from '@/components/settings/parts';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useSession } from '@/features/auth/session-provider';
import { UserAvatar } from '@/features/shell/avatars';
import { AccountLayout, type AccountSection } from './account-layout';

const inPageSections = ['profile', 'appearance'] as const;

export function AccountSettings() {
	const [section, setSection] = useHashSection(inPageSections);
	return (
		<AccountLayout active={section as AccountSection} onSelect={setSection}>
			{section === 'profile' && <Profile />}
			{section === 'appearance' && <Appearance />}
		</AccountLayout>
	);
}

function Profile() {
	const { user } = useSession();
	if (!user) return null;
	return (
		<SettingsCard title="Profile" description="How you appear to teammates in member lists.">
			<div className="flex flex-col gap-6 sm:flex-row sm:items-center">
				<UserAvatar name={user.name} className="size-16 [&_[data-slot=avatar-fallback]]:text-lg" />
				<dl className="grid flex-1 gap-5 sm:grid-cols-3">
					<InfoItem label="Name">{user.name}</InfoItem>
					<InfoItem label="Email">
						<span className="truncate">{user.email}</span>
					</InfoItem>
					<InfoItem label="Role">{user.isAdmin ? 'Instance admin' : 'User'}</InfoItem>
				</dl>
			</div>
		</SettingsCard>
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

const previewDots = ['#22c55e', '#f59e0b', '#22c55e', '#22c55e'];

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
				{previewDots.map((dot, i) => (
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
	// The stored theme is only known in the browser; rendering it during SSR would mismatch on hydration.
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
