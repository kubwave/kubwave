import type { Metadata } from 'next';
import { TeamSettings } from '@/components/settings/team-settings';

export const metadata: Metadata = { title: 'Team settings' };

export default function TeamSettingsPage() {
	return <TeamSettings />;
}
