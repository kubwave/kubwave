export type Member = { id: string; name: string; email: string; initials: string; role: 'owner' | 'member'; joined: string; you?: boolean };

const you: Member = { id: 'u-alex', name: 'Alex Morgan', email: 'alex@acme.dev', initials: 'AM', role: 'owner', joined: 'Mar 2, 2025', you: true };

export const membersByTeam: Record<string, Member[]> = {
	acme: [
		you,
		{ id: 'u-sam', name: 'Sam Rivera', email: 'sam@acme.dev', initials: 'SR', role: 'owner', joined: 'Mar 4, 2025' },
		{ id: 'u-priya', name: 'Priya Natarajan', email: 'priya@acme.dev', initials: 'PN', role: 'member', joined: 'Apr 11, 2025' },
		{ id: 'u-jonas', name: 'Jonas Weber', email: 'jonas@acme.dev', initials: 'JW', role: 'member', joined: 'Jun 23, 2025' },
		{ id: 'u-mei', name: 'Mei Tanaka', email: 'mei@acme.dev', initials: 'MT', role: 'member', joined: 'Nov 8, 2025' },
		{ id: 'u-ola', name: 'Ola Nordmann', email: 'ola@contractors.io', initials: 'ON', role: 'member', joined: 'Aug 30, 2026' }
	],
	personal: [you],
	oss: [
		{ id: 'u-lena', name: 'Lena Fischer', email: 'lena@oss-guild.org', initials: 'LF', role: 'owner', joined: 'Oct 1, 2024' },
		{ ...you, role: 'member', joined: 'Jan 18, 2026' },
		{ id: 'u-diego', name: 'Diego Alvarez', email: 'diego@oss-guild.org', initials: 'DA', role: 'member', joined: 'Feb 2, 2025' },
		{ id: 'u-kim', name: 'Kim Soo-ah', email: 'kim@oss-guild.org', initials: 'KS', role: 'member', joined: 'May 19, 2025' }
	]
};

export type SshKey = {
	id: string;
	name: string;
	type: 'ed25519' | 'rsa' | 'ecdsa';
	source: 'generated' | 'uploaded';
	fingerprint: string;
	added: string;
	publicKey: string;
};

export const sshKeys: SshKey[] = [
	{
		id: 'k1',
		name: 'deploy-jobs',
		type: 'ed25519',
		source: 'generated',
		fingerprint: 'SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8',
		added: 'Mar 12, 2025',
		publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl kubwave@deploy-jobs'
	},
	{
		id: 'k2',
		name: 'gitea-mirror',
		type: 'rsa',
		source: 'uploaded',
		fingerprint: 'SHA256:3Zp8Qm2Lx1vRk9TnY7bWcE4hJ6sFgA0dUiO5yXzN1Ks',
		added: 'Jul 7, 2025',
		publicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC7vbqajDhA3xG0mH9ZnQq2kR6pLwT1u8JcV5sE4yN0fB ops@acme.dev'
	},
	{
		id: 'k3',
		name: 'legacy-bastion',
		type: 'ecdsa',
		source: 'uploaded',
		fingerprint: 'SHA256:Vq4oW9e1Rr7yT2uI8oP3aS6dF0gH5jK1lZ9xC4vB7nM',
		added: 'Jan 30, 2026',
		publicKey: 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEm9dR2x ops@bastion'
	}
];

export type GithubInstallation = { id: string; account: string; kind: 'Organization' | 'User'; repos: number | 'all'; suspended?: boolean };

export const githubInstallations: GithubInstallation[] = [
	{ id: 'gh1', account: 'acme', kind: 'Organization', repos: 'all' },
	{ id: 'gh2', account: 'acme-labs', kind: 'Organization', repos: 7 },
	{ id: 'gh3', account: 'alexmorgan', kind: 'User', repos: 3, suspended: true }
];

export type McpScope = 'read' | 'write' | 'deploy' | 'delete' | 'team:manage';

export const mcpScopes: { value: McpScope; label: string; description: string; destructive?: boolean }[] = [
	{ value: 'read', label: 'Read', description: 'View teams, projects, services, deployments, logs and metrics.' },
	{ value: 'write', label: 'Write', description: 'Create and change projects, environments and services.' },
	{ value: 'deploy', label: 'Deploy', description: 'Start and cancel deployments.' },
	{ value: 'delete', label: 'Delete', description: 'Delete projects, environments and services.', destructive: true },
	{ value: 'team:manage', label: 'Manage teams', description: 'Create teams, manage members and SSH keys.', destructive: true }
];

export const mcpEndpoint = 'https://console.acme.dev/mcp';

export type McpAccess = {
	id: string;
	name: string;
	kind: 'oauth' | 'personal';
	scopes: McpScope[];
	team: string;
	created: string;
	expires: string;
	lastUsed?: string;
	status: 'active' | 'expired' | 'revoked';
};

export const mcpAccess: McpAccess[] = [
	{
		id: 'm1',
		name: 'Claude Code',
		kind: 'oauth',
		scopes: ['read', 'write', 'deploy'],
		team: 'All teams',
		created: 'Sep 2, 2026',
		expires: 'Dec 1, 2026',
		lastUsed: '4m ago',
		status: 'active'
	},
	{
		id: 'm2',
		name: 'ci-release-bot',
		kind: 'personal',
		scopes: ['read', 'deploy'],
		team: 'Acme',
		created: 'Sep 14, 2026',
		expires: 'Oct 14, 2026',
		lastUsed: '2h ago',
		status: 'active'
	},
	{
		id: 'm3',
		name: 'Cursor',
		kind: 'oauth',
		scopes: ['read', 'write', 'deploy', 'delete'],
		team: 'Acme',
		created: 'Aug 20, 2026',
		expires: 'Nov 18, 2026',
		lastUsed: '3d ago',
		status: 'active'
	},
	{
		id: 'm4',
		name: 'laptop claude-code',
		kind: 'personal',
		scopes: ['read'],
		team: 'Personal',
		created: 'Aug 1, 2026',
		expires: 'Aug 8, 2026',
		status: 'expired'
	}
];

export type Session = {
	id: string;
	device: 'desktop' | 'mobile';
	client: string;
	location: string;
	ip: string;
	lastActive: string;
	current?: boolean;
};

export const sessions: Session[] = [
	{ id: 's1', device: 'desktop', client: 'Firefox 143 on Linux', location: 'Berlin, DE', ip: '84.132.18.7', lastActive: 'Active now', current: true },
	{ id: 's2', device: 'desktop', client: 'Safari 26 on macOS', location: 'Berlin, DE', ip: '84.132.18.7', lastActive: '2h ago' },
	{ id: 's3', device: 'mobile', client: 'Safari on iPhone', location: 'Hamburg, DE', ip: '91.64.201.33', lastActive: '3d ago' }
];

export const pullRequests: Record<number, { title: string; branch: string; author: string; opened: string }> = {
	42: { title: 'New checkout flow', branch: 'feat/checkout-v2', author: 'priya', opened: '2d ago' },
	57: { title: 'Fix tax rounding for EU carts', branch: 'fix/eu-tax-rounding', author: 'jonas', opened: '6m ago' }
};

const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export const randomChars = (n: number, alphabet = b64) =>
	Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
