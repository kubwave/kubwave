import { afterEach, describe, expect, test } from 'bun:test';
import { getCliVersion } from '../src/lib/cli-version.js';

// No --define in tests, so KUBWAVE_CLI_VERSION is undefined and getCliVersion() exercises the dev path.
describe('getCliVersion dev override', () => {
	afterEach(() => {
		delete process.env.KUBWAVE_VERSION;
	});

	test("falls back to 'dev' without a compile-time version or env override", () => {
		delete process.env.KUBWAVE_VERSION;
		expect(getCliVersion()).toBe('dev');
	});

	test('KUBWAVE_VERSION overrides the dev fallback (so dev runs hit real image tags)', () => {
		process.env.KUBWAVE_VERSION = '0.4.2';
		expect(getCliVersion()).toBe('0.4.2');
	});

	test('blank/whitespace KUBWAVE_VERSION is ignored', () => {
		process.env.KUBWAVE_VERSION = '   ';
		expect(getCliVersion()).toBe('dev');
	});
});
