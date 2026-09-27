import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { prepareGitAuthEnv, type GitAuthOptions } from '../../git/git-auth.js';
import { runGit } from '../../git/run-git.js';

export interface RepoSnapshot {
	paths: string[];
	pathsTruncated: boolean;
	files: Array<{ path: string; content: string }>;
	envKeys: Record<string, string[]>;
}

export interface SnapshotRepoOptions extends GitAuthOptions {
	branch: string;
	timeoutMs: number;
}

const MAX_PATHS = 5000;
const MAX_FILES = 150;
const MAX_FILE_BYTES = 16 * 1024;
const MAX_TOTAL_BYTES = 300 * 1024;

const SKIPPED_DIRS = new Set([
	'node_modules',
	'vendor',
	'dist',
	'build',
	'out',
	'coverage',
	'.git',
	'.next',
	'.nuxt',
	'.output',
	'.turbo',
	'.venv',
	'__pycache__'
]);

const MANIFEST_FILES = new Set([
	'package.json',
	'pnpm-workspace.yaml',
	'turbo.json',
	'nx.json',
	'lerna.json',
	'deno.json',
	'go.mod',
	'Cargo.toml',
	'pyproject.toml',
	'requirements.txt',
	'composer.json',
	'Gemfile',
	'Procfile',
	'nixpacks.toml'
]);

// Only env templates are read; real .env files never leave the cluster.
const ENV_TEMPLATE_RE = /^\.env(\.[\w-]+)*\.(example|sample|template|dist)$/;
const COMPOSE_RE = /^(docker-)?compose(\.[\w-]+)*\.ya?ml$/;
const FRAMEWORK_CONFIG_RE = /^(next|nuxt|vite|astro|svelte|remix)\.config\.(js|ts|mjs|cjs)$/;
const DOCKERFILE_RE = /^Dockerfile(\.[\w-]+)?$|\.Dockerfile$/;

const PROJECT_ROOT_MARKERS = new Set([
	'package.json',
	'go.mod',
	'Cargo.toml',
	'pyproject.toml',
	'requirements.txt',
	'composer.json',
	'Gemfile',
	'deno.json'
]);

// Each pattern ends right at the variable name, so the key is the trailing identifier of a match.
const ENV_USAGE_PATTERNS = [
	String.raw`process\.env\.[A-Za-z_][A-Za-z0-9_]*`,
	String.raw`process\.env\[["'][A-Za-z_][A-Za-z0-9_]*`,
	String.raw`import\.meta\.env\.[A-Za-z_][A-Za-z0-9_]*`,
	String.raw`Bun\.env\.[A-Za-z_][A-Za-z0-9_]*`,
	String.raw`Deno\.env\.get\(["'][A-Za-z_][A-Za-z0-9_]*`,
	String.raw`os\.environ(\.get\(|\[)["'][A-Za-z_][A-Za-z0-9_]*`,
	String.raw`os\.getenv\(["'][A-Za-z_][A-Za-z0-9_]*`,
	String.raw`os\.Getenv\("[A-Za-z_][A-Za-z0-9_]*`,
	String.raw`ENV(\.fetch\(|\[)["'][A-Za-z_][A-Za-z0-9_]*`,
	String.raw`\benv\(["'][A-Z_][A-Z0-9_]*`
];

const SOURCE_PATHSPECS = [
	'*.ts',
	'*.tsx',
	'*.js',
	'*.jsx',
	'*.mjs',
	'*.cjs',
	'*.vue',
	'*.svelte',
	'*.astro',
	'*.py',
	'*.go',
	'*.rb',
	'*.php',
	'*.rs',
	'*.java',
	'*.kt',
	'*.cs',
	'*.ex',
	'*.exs'
];

function isSkipped(path: string): boolean {
	return path.split('/').some(segment => SKIPPED_DIRS.has(segment));
}

export function isSnapshotFile(path: string): boolean {
	const name = posix.basename(path);
	if (path === 'README.md') return true;
	return (
		MANIFEST_FILES.has(name) || ENV_TEMPLATE_RE.test(name) || COMPOSE_RE.test(name) || FRAMEWORK_CONFIG_RE.test(name) || DOCKERFILE_RE.test(name)
	);
}

export function selectSnapshotFiles(paths: string[]): string[] {
	const depth = (path: string) => path.split('/').length;
	// Shallow files first so root manifests survive the file and byte budgets.
	return paths
		.filter(isSnapshotFile)
		.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))
		.slice(0, MAX_FILES);
}

export function parseEnvUsage(stdout: string): Array<{ path: string; key: string }> {
	const out: Array<{ path: string; key: string }> = [];
	for (const line of stdout.split('\n')) {
		const sep = line.indexOf('\0');
		if (sep === -1) continue;
		const path = line.slice(0, sep).replace(/^[^:]+:/, '');
		const key = /[A-Za-z_][A-Za-z0-9_]*$/.exec(line.slice(sep + 1))?.[0];
		if (key) out.push({ path, key });
	}
	return out;
}

// Attribute each key to the nearest enclosing project (a dir with its own manifest), so monorepo apps get their own lists.
export function groupEnvKeys(usages: Array<{ path: string; key: string }>, projectDirs: Set<string>): Record<string, string[]> {
	const grouped = new Map<string, Set<string>>();
	for (const { path, key } of usages) {
		let dir = dirname(path);
		while (dir !== '.' && !projectDirs.has(dir)) dir = dirname(dir);
		const keys = grouped.get(dir) ?? new Set<string>();
		keys.add(key);
		grouped.set(dir, keys);
	}
	return Object.fromEntries([...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dir, keys]) => [dir, [...keys].sort()]));
}

function truncate(content: string, maxBytes: number): string {
	if (Buffer.byteLength(content, 'utf8') <= maxBytes) return content;
	return `${Buffer.from(content, 'utf8').subarray(0, maxBytes).toString('utf8')}\n[truncated]`;
}

// Shallow, size-filtered fetch into a temp bare repo; nothing is checked out and large blobs are never downloaded.
export async function snapshotRepo(opts: SnapshotRepoOptions): Promise<RepoSnapshot> {
	let workDir: string | undefined;
	const auth = await prepareGitAuthEnv(opts);
	// Missing (filtered) blobs must stay missing; otherwise grep would lazily download every large file.
	const env = { ...auth.env, GIT_NO_LAZY_FETCH: '1' };
	const deadline = Date.now() + opts.timeoutMs;
	const git = (args: string[]) => runGit(args, { cwd: workDir, env, timeoutMs: Math.max(1, deadline - Date.now()) });

	try {
		workDir = await mkdtemp(join(tmpdir(), 'gitsnap-'));
		await git(['init', '--bare']);
		await git(['remote', 'add', 'origin', opts.repoUrl]);
		await git(['fetch', '--depth', '1', '--no-tags', '--filter=blob:limit=256k', 'origin', opts.branch]);

		const allPaths = (await git(['ls-tree', '-r', '--name-only', 'FETCH_HEAD'])).split('\n').filter(path => path && !isSkipped(path));

		const files: RepoSnapshot['files'] = [];
		let totalBytes = 0;
		for (const path of selectSnapshotFiles(allPaths)) {
			const maxBytes = path === 'README.md' ? MAX_FILE_BYTES / 2 : MAX_FILE_BYTES;
			// A blob above the fetch filter is missing locally; skip it instead of failing the snapshot.
			const content = await git(['show', `FETCH_HEAD:${path}`]).catch(() => null);
			if (content === null) continue;
			const clipped = truncate(content, maxBytes);
			totalBytes += Buffer.byteLength(clipped, 'utf8');
			if (totalBytes > MAX_TOTAL_BYTES) break;
			files.push({ path, content: clipped });
		}

		const grepArgs = [
			'grep',
			'-I',
			'-o',
			'-z',
			'-E',
			...ENV_USAGE_PATTERNS.flatMap(pattern => ['-e', pattern]),
			'FETCH_HEAD',
			'--',
			...SOURCE_PATHSPECS
		];
		// git grep exits 1 when nothing matches.
		const grepOut = await git(grepArgs).catch(() => '');
		const projectDirs = new Set(allPaths.filter(path => PROJECT_ROOT_MARKERS.has(posix.basename(path))).map(path => dirname(path)));
		const usages = parseEnvUsage(grepOut).filter(usage => !isSkipped(usage.path));

		return {
			paths: allPaths.slice(0, MAX_PATHS),
			pathsTruncated: allPaths.length > MAX_PATHS,
			files,
			envKeys: groupEnvKeys(usages, projectDirs)
		};
	} finally {
		if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
		await auth.cleanup();
	}
}
