import { describe, expect, test } from 'bun:test';

describe('migration SQL', () => {
	test('0020 compares service_type values as text during fresh installs', async () => {
		const sql = await Bun.file(new URL('../src/migrations/0020_elite_gideon.sql', import.meta.url)).text();

		expect(sql).toContain(`"deployments"."type"::text IN ('dockerfile', 'public-repo', 'private-repo')`);
		expect(sql).not.toContain(`"deployments"."type" IN ('dockerfile', 'public-repo', 'private-repo')`);
	});
});
