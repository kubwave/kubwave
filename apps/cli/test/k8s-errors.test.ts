import { describe, expect, test } from 'bun:test';
import { getStatusBody, getStatusCode, isNotFoundError, isWebhookDenialError } from '../src/lib/k8s-errors.js';

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

describe('isWebhookDenialError', () => {
	test('detects a denial from the webhook itself', () => {
		expect(
			isWebhookDenialError({
				code: 400,
				body: { message: 'admission webhook "vcluster.cnpg.io" denied the request: spec.instances must be >= 1' }
			})
		).toBe(true);
	});

	test('reads the message off a plain Error', () => {
		expect(isWebhookDenialError(new Error('admission webhook "vcluster.cnpg.io" denied the request: nope'))).toBe(true);
	});

	// Verbatim apiserver body from a kubwave install on Infomaniak PCK, where the CNPG webhook pod was
	// not yet reachable from the (externally hosted) control plane. The apiserver never got an answer,
	// so this must not read as a denial.
	test('does not treat a webhook call timeout as a denial', () => {
		expect(
			isWebhookDenialError({
				code: 500,
				body: {
					code: 500,
					message:
						'Internal error occurred: failed calling webhook "mcluster.cnpg.io": failed to call webhook: Post "https://cnpg-webhook-service.cnpg-system.svc:443/mutate-postgresql-cnpg-io-v1-cluster?timeout=10s": context deadline exceeded'
				}
			})
		).toBe(false);
	});

	test('does not treat missing webhook endpoints as a denial', () => {
		expect(
			isWebhookDenialError({
				body: '{"message":"Internal error occurred: failed calling webhook \\"mcluster.cnpg.io\\": no endpoints available for service \\"cnpg-webhook-service\\""}'
			})
		).toBe(false);
	});

	// Authn/authz run before admission, so the webhook was never invoked.
	test('does not treat an RBAC denial as a webhook denial', () => {
		expect(
			isWebhookDenialError({
				code: 403,
				body: { message: 'clusters.postgresql.cnpg.io is forbidden: User "dev" cannot create resource "clusters"' }
			})
		).toBe(false);
	});

	test('does not treat a 404 as a denial', () => {
		expect(isWebhookDenialError({ code: 404, body: { message: 'clusters.postgresql.cnpg.io "probe" not found' } })).toBe(false);
	});

	test('handles non-object errors', () => {
		expect(isWebhookDenialError(undefined)).toBe(false);
		expect(isWebhookDenialError('boom')).toBe(false);
	});
});
