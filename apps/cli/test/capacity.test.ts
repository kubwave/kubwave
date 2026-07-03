import { describe, expect, test } from 'bun:test';
import { addCapacity, formatCpu, formatMem, parseCpuToMillis, parseMemToBytes, sumRequestsFromManifests } from '../src/lib/capacity.js';

describe('parseCpuToMillis', () => {
	test('parses millicores and cores', () => {
		expect(parseCpuToMillis('100m')).toBe(100);
		expect(parseCpuToMillis('2')).toBe(2000);
		expect(parseCpuToMillis('1.5')).toBe(1500);
		expect(parseCpuToMillis('500000n')).toBe(1); // nanocores → millicores (rounded)
	});
	test('handles empty/nullish', () => {
		expect(parseCpuToMillis(undefined)).toBe(0);
		expect(parseCpuToMillis('')).toBe(0);
	});
});

describe('parseMemToBytes', () => {
	test('parses binary and decimal units', () => {
		expect(parseMemToBytes('256Mi')).toBe(256 * 2 ** 20);
		expect(parseMemToBytes('2Gi')).toBe(2 * 2 ** 30);
		expect(parseMemToBytes('1M')).toBe(1_000_000);
		expect(parseMemToBytes('512')).toBe(512);
	});
	test('handles nullish/garbage', () => {
		expect(parseMemToBytes(null)).toBe(0);
		expect(parseMemToBytes('abc')).toBe(0);
	});
});

describe('formatters round-trip', () => {
	test('cpu', () => {
		expect(formatCpu(100)).toBe('100m');
		expect(formatCpu(2000)).toBe('2');
		expect(formatCpu(1500)).toBe('1500m');
	});
	test('mem', () => {
		expect(formatMem(2 * 2 ** 30)).toBe('2Gi');
		expect(formatMem(256 * 2 ** 20)).toBe('256Mi');
	});
});

describe('addCapacity', () => {
	test('sums both dimensions', () => {
		expect(addCapacity({ cpuMillis: 100, memBytes: 10 }, { cpuMillis: 50, memBytes: 5 })).toEqual({ cpuMillis: 150, memBytes: 15 });
	});
});

describe('sumRequestsFromManifests', () => {
	test('scales Deployments by replicas and adds CNPG instances', () => {
		const yaml = `
apiVersion: apps/v1
kind: Deployment
metadata: { name: api }
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: api
          resources: { requests: { cpu: 100m, memory: 128Mi } }
---
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata: { name: pg }
spec:
  instances: 2
  resources: { requests: { cpu: 200m, memory: 256Mi } }
---
apiVersion: apps/v1
kind: DaemonSet
metadata: { name: agent }
spec:
  template:
    spec:
      containers:
        - name: agent
          resources: { requests: { cpu: 500m, memory: 1Gi } }
`;
		const total = sumRequestsFromManifests(yaml);
		// 3×100m + 2×200m = 700m; DaemonSet ignored
		expect(total.cpuMillis).toBe(700);
		// 3×128Mi + 2×256Mi
		expect(total.memBytes).toBe(3 * 128 * 2 ** 20 + 2 * 256 * 2 ** 20);
	});

	test('defaults replicas to 1 and tolerates empty docs', () => {
		const yaml = `
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: db }
spec:
  template:
    spec:
      containers:
        - name: db
          resources: { requests: { cpu: 250m, memory: 512Mi } }
`;
		expect(sumRequestsFromManifests(yaml)).toEqual({ cpuMillis: 250, memBytes: 512 * 2 ** 20 });
	});
});
