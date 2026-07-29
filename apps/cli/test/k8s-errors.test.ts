import { describe, expect, test } from 'bun:test';
import { getStatusBody, getStatusCode, isNotFoundError, isWebhookUnavailableError } from '../src/lib/k8s-errors.js';

describe('k8s error helpers', () => {
	test('reads v1 client status codes', () => {
		expect(getStatusCode({ code: 403 })).toBe(403);
	});

	test('reads legacy response status codes', () => {
		expect(getStatusCode({ response: { statusCode: 404 } })).toBe(404);
		expect(isNotFoundError({ response: { statusCode: 404 } })).toBe(true);
	});

	test('reads response bodies', () => {
		const body = { code: 409, message: 'already exists' };
		expect(getStatusCode({ response: { body } })).toBe(409);
		expect(getStatusBody({ response: { body } })).toBe(body);
	});

	test('parses string JSON bodies', () => {
		expect(getStatusCode({ body: '{"code":422}' })).toBe(422);
	});

	test('handles non-JSON string bodies gracefully', () => {
		expect(getStatusCode({ body: 'not json' })).toBeUndefined();
	});

	test('handles JSON parse failure in body gracefully', () => {
		expect(getStatusCode({ body: '{invalid}' })).toBeUndefined();
	});
});

describe('isWebhookUnavailableError', () => {
	const webhookTimeout = {
		code: 500,
		body: {
			code: 500,
			message:
				'Internal error occurred: failed calling webhook "mcluster.cnpg.io": failed to call webhook: Post "https://cnpg-webhook-service.cnpg-system.svc:443/mutate-postgresql-cnpg-io-v1-cluster?timeout=10s": context deadline exceeded'
		}
	};

	test('detects a webhook call timeout', () => {
		expect(isWebhookUnavailableError(webhookTimeout)).toBe(true);
	});

	test('detects a webhook with no ready endpoints', () => {
		expect(
			isWebhookUnavailableError({
				body: '{"message":"Internal error occurred: failed calling webhook \\"mcluster.cnpg.io\\": no endpoints available for service \\"cnpg-webhook-service\\""}'
			})
		).toBe(true);
	});

	test('reads the message off a plain Error', () => {
		expect(isWebhookUnavailableError(new Error('Internal error occurred: failed calling webhook "mcluster.cnpg.io": EOF'))).toBe(true);
	});

	test('does not treat a webhook rejection as unavailable', () => {
		expect(
			isWebhookUnavailableError({
				code: 400,
				body: { message: 'admission webhook "vcluster.cnpg.io" denied the request: spec.instances must be >= 1' }
			})
		).toBe(false);
	});

	test('does not treat a 404 as unavailable', () => {
		expect(isWebhookUnavailableError({ code: 404, body: { message: 'clusters.postgresql.cnpg.io "probe" not found' } })).toBe(false);
	});

	test('handles non-object errors', () => {
		expect(isWebhookUnavailableError(undefined)).toBe(false);
		expect(isWebhookUnavailableError('boom')).toBe(false);
	});
});
