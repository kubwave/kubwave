import { describe, expect, test } from 'bun:test';
import { basicAuthHeader, extraHeaderConfigKey, gitTokenAuthEnv } from '~/modules/git/git-clone-auth';

describe('git-clone-auth', () => {
	test('basicAuthHeader base64-encodes x-access-token:<token>', () => {
		const expected = `Authorization: Basic ${Buffer.from('x-access-token:ghs_abc').toString('base64')}`;
		expect(basicAuthHeader('ghs_abc')).toBe(expected);
	});

	test('extraHeaderConfigKey scopes the header to the repo origin', () => {
		expect(extraHeaderConfigKey('https://github.com/org/repo.git')).toBe('http.https://github.com/.extraheader');
		expect(extraHeaderConfigKey('https://ghe.acme.dev/org/repo.git')).toBe('http.https://ghe.acme.dev/.extraheader');
	});

	test('gitTokenAuthEnv yields the GIT_CONFIG_* triple, never the token in a URL', () => {
		const env = gitTokenAuthEnv('https://github.com/org/repo.git', 'ghs_abc');
		expect(env).toEqual({
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
			GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from('x-access-token:ghs_abc').toString('base64')}`
		});
	});
});
