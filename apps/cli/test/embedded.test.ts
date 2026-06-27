import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { resolve as realResolve, join as realJoin } from 'node:path';

// The _prepare-embedded hook 0-bytes the embedded helm/chart.tgz in a non-compiled checkout, so real node:fs would never exercise the extract path.
// In-memory node:fs (tracks size + exec bit) so cache-trust and the atomic write→chmod→rename run for real; node:path real, node:os pinned to a fixed homedir.

interface FsEntry {
	size: number;
	exec: boolean;
}

let fsEntries: Record<string, FsEntry> = {};
const writeLog: string[] = [];
const chmodLog: Array<{ path: string; mode: number }> = [];
const renameLog: Array<{ from: string; to: string }> = [];

const embeddedHelmPath = realResolve(import.meta.dir, '..', 'build', 'embedded', 'helm');
const embeddedChartPath = realResolve(import.meta.dir, '..', 'build', 'embedded', 'chart.tgz');

// Mirror getCliVersion()'s 'dev' fallback (no --define in tests) and the source's CACHE_BASE join.
const cacheVersionDir = realJoin('/home/test', '.cache', 'kubwave', 'dev');
const expectedHelmCachePath = realJoin(cacheVersionDir, 'helm');
const expectedChartCachePath = realJoin(cacheVersionDir, 'chart.tgz');

// Dev-chart fallback dirs that getChartPath() probes, resolved exactly as the source does.
const devChartDir = realResolve(import.meta.dir, '..', 'src', 'lib', '..', '..', '..', '..', 'infra', 'helm', 'kubwave');
const devChartYaml = realJoin(devChartDir, 'Chart.yaml');

const originalEnvHelm = process.env.KUBWAVE_HELM_BIN;

function file(size: number, exec = false): FsEntry {
	return { size, exec };
}

beforeEach(() => {
	fsEntries = {};
	writeLog.length = 0;
	chmodLog.length = 0;
	renameLog.length = 0;
	delete process.env.KUBWAVE_HELM_BIN;
});

afterEach(() => {
	if (originalEnvHelm !== undefined) {
		process.env.KUBWAVE_HELM_BIN = originalEnvHelm;
	} else {
		delete process.env.KUBWAVE_HELM_BIN;
	}
});

mock.module('node:os', () => ({ homedir: () => '/home/test' }));
mock.module('node:fs', () => {
	const X_OK = 1;
	const get = (p: string): FsEntry => {
		const entry = fsEntries[p];
		if (!entry) throw new Error(`ENOENT: ${p}`);
		return entry;
	};
	return {
		existsSync: (p: string) => p in fsEntries,
		statSync: (p: string) => ({ size: get(p).size }),
		readFileSync: (p: string) => new Uint8Array(get(p).size),
		writeFileSync: (p: string, data: Uint8Array) => {
			writeLog.push(p);
			// A freshly-written temp file has the source's bytes but no exec bit yet.
			fsEntries[p] = file(data.byteLength, false);
		},
		chmodSync: (p: string, mode: number) => {
			chmodLog.push({ path: p, mode });
			get(p).exec = (mode & 0o111) !== 0;
		},
		renameSync: (from: string, to: string) => {
			renameLog.push({ from, to });
			fsEntries[to] = get(from);
			delete fsEntries[from];
		},
		mkdirSync: () => {},
		accessSync: (p: string, mode: number) => {
			const entry = get(p);
			if (mode === X_OK && !entry.exec) throw new Error(`EACCES: ${p}`);
		},
		constants: { X_OK }
	};
});

const { getHelmPath, getChartPath } = await import('../src/lib/embedded.js');

describe('getHelmPath', () => {
	test('uses KUBWAVE_HELM_BIN when set and executable', () => {
		process.env.KUBWAVE_HELM_BIN = '/custom/helm';
		fsEntries = { '/custom/helm': file(100, true) };
		expect(getHelmPath()).toBe('/custom/helm');
	});

	test('falls through to HELM_IN_IMAGE when KUBWAVE_HELM_BIN set but not executable', () => {
		process.env.KUBWAVE_HELM_BIN = '/bad/helm';
		// Present but missing the exec bit, so accessSync(X_OK) rejects it.
		fsEntries = { '/bad/helm': file(100, false), '/usr/local/bin/helm': file(100, true) };
		expect(getHelmPath()).toBe('/usr/local/bin/helm');
	});

	test('uses HELM_IN_IMAGE when it exists and no env override', () => {
		fsEntries = { '/usr/local/bin/helm': file(100, true) };
		expect(getHelmPath()).toBe('/usr/local/bin/helm');
	});

	test('uses a cached embedded helm when its size matches and the exec bit survived', () => {
		fsEntries = {
			[embeddedHelmPath]: file(2048, false),
			[expectedHelmCachePath]: file(2048, true)
		};
		expect(getHelmPath()).toBe(expectedHelmCachePath);
		// A trusted cache hit must not re-extract.
		expect(writeLog).toEqual([]);
		expect(renameLog).toEqual([]);
	});

	test('re-extracts when the cached helm size differs from the embedded source', () => {
		fsEntries = {
			[embeddedHelmPath]: file(2048, false),
			[expectedHelmCachePath]: file(1024, true) // stale: wrong size
		};
		expect(getHelmPath()).toBe(expectedHelmCachePath);
		// Size mismatch defeats the cache-trust check, so we rewrite atomically.
		expect(renameLog).toEqual([{ from: `${expectedHelmCachePath}.${process.pid}.tmp`, to: expectedHelmCachePath }]);
		expect(fsEntries[expectedHelmCachePath]).toEqual(file(2048, true));
	});

	test('re-extracts when the cached helm size matches but lost its exec bit', () => {
		fsEntries = {
			[embeddedHelmPath]: file(2048, false),
			[expectedHelmCachePath]: file(2048, false) // size ok, but not executable
		};
		expect(getHelmPath()).toBe(expectedHelmCachePath);
		// An interrupted prior run (write without chmod) must not be trusted: rewrite + chmod.
		expect(writeLog).toEqual([`${expectedHelmCachePath}.${process.pid}.tmp`]);
		expect(chmodLog).toEqual([{ path: `${expectedHelmCachePath}.${process.pid}.tmp`, mode: 0o755 }]);
		expect(fsEntries[expectedHelmCachePath]).toEqual(file(2048, true));
	});

	test('extracts embedded helm when no cached copy exists', () => {
		fsEntries = { [embeddedHelmPath]: file(2048, false) };
		expect(getHelmPath()).toBe(expectedHelmCachePath);
		// Atomic write→chmod(0755)→rename, then the extracted file is executable.
		const tmp = `${expectedHelmCachePath}.${process.pid}.tmp`;
		expect(writeLog).toEqual([tmp]);
		expect(chmodLog).toEqual([{ path: tmp, mode: 0o755 }]);
		expect(renameLog).toEqual([{ from: tmp, to: expectedHelmCachePath }]);
		expect(fsEntries[expectedHelmCachePath]).toEqual(file(2048, true));
		// The temp file no longer lingers after the rename.
		expect(tmp in fsEntries).toBe(false);
	});

	test('throws when no helm is available anywhere', () => {
		fsEntries = {};
		expect(() => getHelmPath()).toThrow('Helm not found');
	});

	test('includes all attempted paths in the error message', () => {
		fsEntries = {};
		process.env.KUBWAVE_HELM_BIN = '/some/path';
		const error = () => getHelmPath();
		expect(error).toThrow(/Helm not found/);
		expect(error).toThrow(/\$KUBWAVE_HELM_BIN/);
		expect(error).toThrow(/\/usr\/local\/bin\/helm/);
	});

	test('when KUBWAVE_HELM_BIN is unset, the error lists it as unset', () => {
		delete process.env.KUBWAVE_HELM_BIN;
		fsEntries = {};
		const error = () => getHelmPath();
		expect(error).toThrow(/\$KUBWAVE_HELM_BIN \(unset\)/);
	});
});

describe('getChartPath', () => {
	test('extracts an embedded chart archive when bundled', () => {
		fsEntries = { [embeddedChartPath]: file(4096, false) };
		expect(getChartPath()).toBe(expectedChartCachePath);
		const tmp = `${expectedChartCachePath}.${process.pid}.tmp`;
		// Charts are not executable: extracted with mode 0644.
		expect(chmodLog).toEqual([{ path: tmp, mode: 0o644 }]);
		expect(renameLog).toEqual([{ from: tmp, to: expectedChartCachePath }]);
		expect(fsEntries[expectedChartCachePath]).toEqual(file(4096, false));
	});

	test('uses a cached embedded chart when its size matches (no exec bit required)', () => {
		fsEntries = {
			[embeddedChartPath]: file(4096, false),
			[expectedChartCachePath]: file(4096, false)
		};
		expect(getChartPath()).toBe(expectedChartCachePath);
		// A non-executable artifact is trusted on size alone, so no rewrite.
		expect(writeLog).toEqual([]);
		expect(renameLog).toEqual([]);
	});

	test('falls back to the dev chart directory when no archive is bundled', () => {
		fsEntries = { [devChartYaml]: file(200, false) };
		expect(getChartPath()).toBe(devChartDir);
	});

	test('throws when chart is not available', () => {
		fsEntries = {};
		expect(() => getChartPath()).toThrow('Helm chart not found');
	});
});
