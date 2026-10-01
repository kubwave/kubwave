import { expect, test } from 'bun:test';
import { safeBuildFilePath, redactBuildLog } from '../src/index';

test('rejects traversal and absolute paths when materializing build files', () => {
	for (const path of ['../key', '/etc/passwd', 'a/../../key', '.', 'a\\b', 'a\0b']) expect(() => safeBuildFilePath(path)).toThrow();
	expect(safeBuildFilePath('.docker/config.json')).toBe('.docker/config.json');
});

test('redacts tokens without changing regular build output', () => {
	expect(redactBuildLog('failed with secret-token here', ['secret-token'])).toBe('failed with [REDACTED] here');
	expect(redactBuildLog('building image', ['secret-token'])).toBe('building image');
});
