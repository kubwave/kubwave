import { describe, expect, test } from 'bun:test';
import { buildCatalog } from '../src/build-catalog';

describe('buildCatalog', () => {
	test('builds the templates with inlined logos and exactly one primary each', () => {
		const catalog = buildCatalog();
		const ids = catalog.map(t => t.id);
		// Sorted by id; assert the known templates are present (membership, not an exact list).
		expect(ids).toContain('ghost');
		expect(ids).toContain('supabase');
		expect(ids).toContain('uptime-kuma');
		for (const t of catalog) {
			expect(t.logoSvg.length).toBeGreaterThan(0);
			expect(t.services.filter(s => s.primary)).toHaveLength(1);
		}
	});

	test('the supabase template wires its full service set', () => {
		const supabase = buildCatalog().find(t => t.id === 'supabase');
		expect(supabase).toBeDefined();
		expect(supabase!.services.map(s => s.name)).toEqual(['db', 'meta', 'auth', 'rest', 'realtime', 'storage', 'studio', 'kong']);
		// anon/service_role keys are minted as JWTs signed with the jwt_secret.
		const jwtSecrets = supabase!.secrets.filter(s => s.generate === 'jwt');
		expect(jwtSecrets.map(s => s.key)).toEqual(['anon_key', 'service_role_key']);
	});
});
