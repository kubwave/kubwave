import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync, statSync, accessSync, renameSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { getCliVersion } from '~/lib/cli-version.js';

// bun --compile embeds these into /$bunfs/...; in dev they're real paths, and _prepare-embedded writes empty placeholders that fail hasContent().
import helmEmbeddedPath from '../../build/embedded/helm' with { type: 'file' };
import chartEmbeddedPath from '../../build/embedded/chart.tgz' with { type: 'file' };

const CACHE_BASE = join(homedir(), '.cache', 'kubwave');

// Real helm baked into the CLI image (read-only but executable); running it here sidesteps the noexec writable cache that breaks extraction.
const HELM_IN_IMAGE = '/usr/local/bin/helm';

function hasContent(path: string): boolean {
	try {
		return statSync(path).size > 0;
	} catch {
		return false;
	}
}

function isExecutable(path: string): boolean {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function extractIfNeeded(srcPath: string, destName: string, mode: number): string {
	const versionDir = join(CACHE_BASE, getCliVersion());
	mkdirSync(versionDir, { recursive: true });
	const dest = join(versionDir, destName);

	// Trust a cached copy only when size matches and — for executables — the exec bit survived; an interrupted write-without-chmod must not be reused.
	const wantExec = (mode & 0o111) !== 0;
	const cached = existsSync(dest) && statSync(dest).size === statSync(srcPath).size && (!wantExec || isExecutable(dest));
	if (cached) {
		return dest;
	}

	// Atomic write→chmod→rename so a concurrent reader never sees a partial/non-executable file.
	const tmp = `${dest}.${process.pid}.tmp`;
	writeFileSync(tmp, readFileSync(srcPath));
	chmodSync(tmp, mode);
	renameSync(tmp, dest);
	return dest;
}

export function getHelmPath(): string {
	// 1. Explicit override — the update Job sets this to the baked-in helm so it never extracts onto the (possibly noexec) writable volume.
	const envHelm = process.env.KUBWAVE_HELM_BIN;
	if (envHelm && isExecutable(envHelm)) return envHelm;

	// 2. Baked-in path: present in the CLI image and on dev machines with helm in /usr/local/bin.
	if (isExecutable(HELM_IN_IMAGE)) return HELM_IN_IMAGE;

	// 3. Standalone binary: extract the embedded helm to the user's cache and run it from there.
	if (hasContent(helmEmbeddedPath)) return extractIfNeeded(helmEmbeddedPath, 'helm', 0o755);

	// 4. Dev fallback: system helm on $PATH (Bun.which resolves $PATH without needing `which`).
	const systemHelm = Bun.which('helm');
	if (systemHelm && isExecutable(systemHelm)) return systemHelm;

	const tried = [
		envHelm ? `$KUBWAVE_HELM_BIN (${envHelm})` : '$KUBWAVE_HELM_BIN (unset)',
		HELM_IN_IMAGE,
		'embedded helm (none bundled)',
		'helm on $PATH'
	];
	throw new Error(
		`Helm not found or not executable. Tried:\n  - ${tried.join('\n  - ')}\nInstall Helm (https://helm.sh/docs/intro/install/), or set KUBWAVE_HELM_BIN to an executable helm binary.`
	);
}

export function getChartPath(): string {
	if (hasContent(chartEmbeddedPath)) {
		return extractIfNeeded(chartEmbeddedPath, 'chart.tgz', 0o644);
	}
	// Dev fallback: chart source directory in the monorepo
	for (const devChart of [
		resolve(import.meta.dir, '..', '..', '..', '..', 'infra', 'helm', 'kubwave'),
		resolve(process.cwd(), 'infra', 'helm', 'kubwave')
	]) {
		if (existsSync(join(devChart, 'Chart.yaml'))) return devChart;
	}
	throw new Error('Helm chart not found. Make sure you are in the kubwave repo or are using the compiled CLI binary.');
}
