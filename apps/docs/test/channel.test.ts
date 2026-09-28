import { describe, expect, test } from 'bun:test';
import { buildInstallCommand, channelUrl, resolveDocsChannel } from '../lib/channel';

describe('resolveDocsChannel', () => {
	test('keeps the next channel for prerelease builds', () => {
		expect(resolveDocsChannel('next')).toBe('next');
	});

	test('falls back to latest when the build sets no channel', () => {
		expect(resolveDocsChannel(undefined)).toBe('latest');
		expect(resolveDocsChannel('')).toBe('latest');
	});

	test('falls back to latest for unknown channels', () => {
		expect(resolveDocsChannel('edge')).toBe('latest');
		expect(resolveDocsChannel('toString')).toBe('latest');
	});
});

describe('buildInstallCommand', () => {
	test('adds the preview channel on the next docs build', () => {
		expect(buildInstallCommand('next')).toBe('curl -fsSL https://get.kubwave.com | bash -s -- --channel preview');
	});

	test('uses the script default on the stable docs build', () => {
		expect(buildInstallCommand('latest')).toBe('curl -fsSL https://get.kubwave.com | bash');
	});
});

describe('channelUrl', () => {
	test('points /start/quickstart/ at the same page on the next site', () => {
		expect(channelUrl('next', '/start/quickstart/')).toBe('https://docs-next.kubwave.com/start/quickstart/');
	});

	test('points the home page at the stable site root', () => {
		expect(channelUrl('latest', '/')).toBe('https://docs.kubwave.com/');
	});
});
