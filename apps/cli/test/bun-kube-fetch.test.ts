import { describe, expect, test } from 'bun:test';
import https from 'node:https';
import { tlsFromHttpsAgent } from '../src/lib/bun-kube-fetch.js';

describe('bun kube fetch patch', () => {
	test('extracts tls options from an https agent', () => {
		const ca = Buffer.from('ca');
		const cert = Buffer.from('cert');
		const key = Buffer.from('key');
		const agent = new https.Agent({ ca, cert, key, rejectUnauthorized: true });

		expect(tlsFromHttpsAgent(agent)).toEqual({
			ca,
			cert,
			key,
			rejectUnauthorized: true
		});
	});

	test('returns undefined when the agent has no tls material', () => {
		expect(tlsFromHttpsAgent(new https.Agent())).toBeUndefined();
		expect(tlsFromHttpsAgent(undefined)).toBeUndefined();
	});
});
