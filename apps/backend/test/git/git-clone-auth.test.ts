import { describe, expect, test } from 'bun:test';
import { basicAuthHeader, extraHeaderConfigKey, giteaTokenAuthHeader, gitHeaderAuthEnv, gitTokenAuthEnv } from '~/modules/git/git-clone-auth';

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

	test('giteaTokenAuthHeader uses a token scheme, not GitHub basic auth', () => {
		expect(giteaTokenAuthHeader('gitea_abc')).toBe('Authorization: token gitea_abc');
	});

	test('gitHeaderAuthEnv injects an arbitrary extraheader without putting the token in a URL', () => {
		const env = gitHeaderAuthEnv('https://gitea.example/org/repo.git', giteaTokenAuthHeader('gitea_abc'));
		expect(env).toEqual({
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'http.https://gitea.example/.extraheader',
			GIT_CONFIG_VALUE_0: 'Authorization: token gitea_abc'
		});
		expect(JSON.stringify(env)).not.toContain('https://gitea_abc@');
	});
});
