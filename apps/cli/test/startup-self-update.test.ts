import { describe, expect, test } from 'bun:test';
import { maybeRunStartupSelfUpdate, SELF_REFRESHED_ENV, shouldSkipStartupSelfUpdate } from '../src/lib/startup-self-update.js';
import type { ProgressReporter } from '../src/lib/progress.js';
import type { ReleaseInfo } from '../src/lib/releases.js';

const release: ReleaseInfo = {
	tag: 'v1.2.3',
	version: '1.2.3',
	prerelease: false,
	assets: [
		{
			name: 'kubwave-darwin-arm64',
			size: 123,
			downloadUrl: 'https://api.github.com/repos/kubwave/kubwave/releases/assets/123'
		}
	]
};

function reporter(): ProgressReporter & { logs: string[] } {
	const logs: string[] = [];
	return {
		logs,
		start: phase => logs.push(`start:${phase}`),
		succeed: phase => logs.push(`succeed:${phase}`),
		fail: (phase, error) => logs.push(`fail:${phase}:${error}`),
		log: message => logs.push(message),
		finish: (status, message) => {
			logs.push(`finish:${status}:${message}`);
		}
	};
}

describe('startup self-update', () => {
	test('skips dev builds, update, version, and already refreshed runs', () => {
		expect(shouldSkipStartupSelfUpdate('status', {}, 'dev')).toBe(true);
		expect(shouldSkipStartupSelfUpdate('update', {}, '1.0.0')).toBe(true);
		expect(shouldSkipStartupSelfUpdate('version', {}, '1.0.0')).toBe(true);
		expect(shouldSkipStartupSelfUpdate('status', { [SELF_REFRESHED_ENV]: '1' }, '1.0.0')).toBe(true);
		expect(shouldSkipStartupSelfUpdate('status', {}, '1.0.0')).toBe(false);
	});

	test('continues when current version already matches latest', async () => {
		let prompted = false;
		const out = reporter();
		await maybeRunStartupSelfUpdate({
			commandName: 'status',
			currentVersion: '1.2.3',
			reporter: out,
			resolveLatest: async () => release,
			describe: () => ({ current: '1.2.3', target: '1.2.3', needed: false }),
			confirm: async () => {
				prompted = true;
				return true;
			}
		});

		expect(prompted).toBe(false);
		expect(out.logs).toEqual([]);
	});

	test('logs only in non-interactive mode', async () => {
		let refreshed = false;
		const out = reporter();
		await maybeRunStartupSelfUpdate({
			commandName: 'status',
			currentVersion: '1.0.0',
			stdinIsTTY: false,
			stdoutIsTTY: false,
			reporter: out,
			resolveLatest: async () => release,
			describe: () => ({ current: '1.0.0', target: '1.2.3', needed: true }),
			getAssetName: () => 'kubwave-darwin-arm64',
			refresh: async () => {
				refreshed = true;
				throw new Error('should not refresh');
			}
		});

		expect(refreshed).toBe(false);
		expect(out.logs).toEqual(['New kubwave CLI available: v1.0.0 -> v1.2.3. Update now? Run kubwave update to refresh the local binary.']);
	});

	test('continues when platform asset is missing', async () => {
		let prompted = false;
		const out = reporter();
		await maybeRunStartupSelfUpdate({
			commandName: 'status',
			currentVersion: '1.0.0',
			stdinIsTTY: true,
			stdoutIsTTY: true,
			reporter: out,
			resolveLatest: async () => release,
			describe: () => ({ current: '1.0.0', target: '1.2.3', needed: true }),
			getAssetName: () => 'kubwave-linux-x64',
			confirm: async () => {
				prompted = true;
				return true;
			}
		});

		expect(prompted).toBe(false);
		expect(out.logs).toEqual(['New CLI v1.2.3 is available, but no kubwave-linux-x64 asset was published.']);
	});

	test('skips when getAssetName throws an error', async () => {
		const out = reporter();
		await maybeRunStartupSelfUpdate({
			commandName: 'status',
			currentVersion: '1.0.0',
			stdinIsTTY: true,
			stdoutIsTTY: true,
			reporter: out,
			resolveLatest: async () => release,
			describe: () => ({ current: '1.0.0', target: '1.2.3', needed: true }),
			getAssetName: () => {
				throw new Error('unsupported platform');
			},
			confirm: async () => true
		});

		expect(out.logs).toEqual(['CLI update check skipped: unsupported platform']);
	});

	test('refreshes and forwards original args when accepted', async () => {
		const out = reporter();
		await expect(
			maybeRunStartupSelfUpdate({
				commandName: 'status',
				currentVersion: '1.0.0',
				argv: ['status', '--json'],
				stdinIsTTY: true,
				stdoutIsTTY: true,
				reporter: out,
				resolveLatest: async channel => {
					expect(channel).toBe('preview');
					return release;
				},
				describe: () => ({ current: '1.0.0', target: '1.2.3', needed: true }),
				getAssetName: () => 'kubwave-darwin-arm64',
				confirm: async message => {
					expect(message).toBe('New kubwave CLI available: v1.0.0 -> v1.2.3. Update now?');
					return true;
				},
				env: { KUBWAVE_CHANNEL: 'preview' },
				refresh: async opts => {
					expect(opts.release).toBe(release);
					expect(opts.forwardArgs).toEqual(['status', '--json']);
					expect(opts.env).toEqual({ [SELF_REFRESHED_ENV]: '1' });
					throw new Error('reexec');
				}
			})
		).rejects.toThrow('reexec');
	});

	test('continues when interactive user declines', async () => {
		let refreshed = false;
		await maybeRunStartupSelfUpdate({
			commandName: 'status',
			currentVersion: '1.0.0',
			stdinIsTTY: true,
			stdoutIsTTY: true,
			reporter: reporter(),
			resolveLatest: async () => release,
			describe: () => ({ current: '1.0.0', target: '1.2.3', needed: true }),
			getAssetName: () => 'kubwave-darwin-arm64',
			confirm: async () => false,
			refresh: async () => {
				refreshed = true;
				throw new Error('should not refresh');
			}
		});

		expect(refreshed).toBe(false);
	});

	test('release lookup failures do not block the command', async () => {
		const out = reporter();
		await maybeRunStartupSelfUpdate({
			commandName: 'status',
			currentVersion: '1.0.0',
			reporter: out,
			resolveLatest: async () => {
				throw new Error('offline');
			}
		});

		expect(out.logs).toEqual(['CLI update check skipped: offline']);
	});
});
