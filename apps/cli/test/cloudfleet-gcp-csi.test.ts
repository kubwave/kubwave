import { describe, expect, test } from 'bun:test';
import { parseAllDocuments } from 'yaml';
import { CSI_CATALOG, GCP_PD_CSI_VERSION } from '../src/platforms/cloudfleet/csi-catalog.js';

describe('gcp csi catalog entry', () => {
	test('uses a pinned manifest install in the gce-pd-csi-driver namespace', () => {
		const gcp = CSI_CATALOG.gcp;
		expect(gcp.install.kind).toBe('manifest');
		if (gcp.install.kind !== 'manifest') throw new Error('expected manifest install');
		expect(gcp.install.namespace).toBe('gce-pd-csi-driver');
		expect(gcp.install.driverVersion).toBe(GCP_PD_CSI_VERSION);
		expect(gcp.install.manifest.length).toBeGreaterThan(0);
	});

	test('hetzner and aws stay helm installs', () => {
		expect(CSI_CATALOG.hetzner.install.kind).toBe('helm');
		expect(CSI_CATALOG.aws.install.kind).toBe('helm');
	});

	test('embedded manifest renders the expected GCP driver objects', () => {
		const gcp = CSI_CATALOG.gcp;
		if (gcp.install.kind !== 'manifest') throw new Error('expected manifest install');
		const kinds = parseAllDocuments(gcp.install.manifest)
			.map(d => (d.toJSON() as { kind?: string } | null)?.kind)
			.filter(Boolean);
		expect(kinds).toContain('Namespace');
		expect(kinds).toContain('CSIDriver');
		expect(kinds).toContain('DaemonSet');
		expect(kinds.some(k => k === 'Deployment' || k === 'StatefulSet')).toBe(true);
	});
});
