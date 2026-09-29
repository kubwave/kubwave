import { RequireAdmin } from '@/features/auth/session-guards';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
	return <RequireAdmin>{children}</RequireAdmin>;
}
