import { describe, expect, mock, test } from 'bun:test';

mock.module('~/lib/cli-version.js', () => ({
	getCliVersion: () => '1.2.3',
	getHelmVersion: () => 'v3.14.0',
	isDevBuild: () => false
}));

const { describeRefresh } = await import('../src/lib/self-refresh.js');

describe('describeRefresh with non-dev version', () => {
	test('skips when current matches target', () => {
		expect(describeRefresh('1.2.3')).toEqual({
			current: '1.2.3',
			target: '1.2.3',
			needed: false,
			reason: 'already on target version'
		});
	});

	test('needs refresh when current differs from target', () => {
		expect(describeRefresh('2.0.0')).toEqual({
			current: '1.2.3',
			target: '2.0.0',
			needed: true
		});
	});
});
