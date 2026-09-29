'use client';

import { useQuery } from '@tanstack/react-query';
import { GaugeIcon, NetworkIcon, PlugIcon, ServerCogIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { SaveBar } from '@/components/settings/save-bar';
import { SettingsLayout } from '@/components/settings-layout';
import { IntegrationsSection } from './integrations-section';
import { updateSummary, type SettingsTab } from './model';
import { NetworkSection, useTcpPoolGroup } from './network-section';
import { ScalingSection } from './scaling-section';
import { SystemSection } from './system-section';
import { useSaveBar } from './use-settings-group';
import { useIntegrationGroups, useScalingGroups } from './use-settings-tabs';
import { versionQuery } from './use-system';

const unsavedDot = (count: number) => (count ? <span className="size-1.5 rounded-full bg-warning" aria-label={`${count} unsaved`} /> : undefined);

export function PlatformSettingsPage({
	initialTab,
	githubConnected,
	gitError
}: {
	initialTab: SettingsTab;
	githubConnected: boolean;
	gitError?: string;
}) {
	const [tab, setTab] = useState(initialTab);
	const { available, latest } = updateSummary(useQuery(versionQuery).data);
	const scaling = useScalingGroups();
	const integrations = useIntegrationGroups();
	const network = useTcpPoolGroup();
	// Drafts live here, not in the tabs, so edits survive switching tabs and one save bar covers them all.
	const scalingGroups = [scaling.ha, scaling.concurrency, scaling.prPreview, scaling.autoscaling];
	const integrationGroups = Object.values(integrations);
	const saveBar = useSaveBar([...scalingGroups, ...integrationGroups]);

	// The GitHub App manifest callback lands here; the toast id keeps a strict-mode double run to one toast.
	useEffect(() => {
		if (!githubConnected && gitError === undefined) return;
		if (gitError !== undefined) toast.error('GitHub connection failed', { id: 'github-callback', description: gitError });
		else toast.success('GitHub App connected', { id: 'github-callback', description: 'Teams can now install it on their repositories.' });
		window.history.replaceState(null, '', '?tab=integrations');
	}, [githubConnected, gitError]);

	const changeTab = (next: string) => {
		setTab(next as SettingsTab);
		window.history.replaceState(null, '', `?tab=${next}`);
	};

	return (
		<div className="mx-auto w-full max-w-6xl space-y-8 px-6 py-8">
			<PageHeader title="Platform settings" description="Instance-wide configuration. Changes apply to every team on this cluster." />

			<SettingsLayout
				active={tab}
				onChange={changeTab}
				sections={[
					{
						id: 'system',
						label: 'System',
						icon: ServerCogIcon,
						badge: available ? <span className="rounded-full bg-primary/15 px-1.5 font-mono text-[10px] text-primary-text">{latest}</span> : undefined
					},
					{ id: 'scaling', label: 'Scaling & storage', icon: GaugeIcon, badge: unsavedDot(scalingGroups.filter(group => group.dirty).length) },
					{ id: 'network', label: 'Network', icon: NetworkIcon, badge: unsavedDot(network.group.dirty ? 1 : 0) },
					{ id: 'integrations', label: 'Integrations', icon: PlugIcon, badge: unsavedDot(integrationGroups.filter(group => group.dirty).length) }
				]}
			>
				{tab === 'system' && <SystemSection />}
				{tab === 'scaling' && <ScalingSection groups={scaling} />}
				{tab === 'network' && <NetworkSection {...network} />}
				{tab === 'integrations' && <IntegrationsSection groups={integrations} />}
			</SettingsLayout>

			<SaveBar {...saveBar} />
		</div>
	);
}
