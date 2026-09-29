import type { Metadata } from 'next';
import { SetupWizard } from '@/features/auth/setup-wizard';

export const metadata: Metadata = { title: 'Set up kubwave' };

export default function SetupPage() {
	return <SetupWizard />;
}
