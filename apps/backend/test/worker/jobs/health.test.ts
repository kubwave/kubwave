import { afterEach, describe, expect, test } from 'bun:test';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startWorkerHealthServer } from '~/modules/worker/health-server';

// startWorkerHealthServer binds an injectable port; bind to 0 (OS-assigned ephemeral, no
// fixed-port race), wait for `listening`, and exercise the real Node HTTP handler over loopback.

let server: Server | null = null;

afterEach(async () => {
	if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
	server = null;
});

async function start(): Promise<number> {
	server = startWorkerHealthServer(0);
	await once(server, 'listening');
	return (server.address() as AddressInfo).port;
}

describe('startWorkerHealthServer', () => {
	test('binds the requested port (0 → an OS-assigned free port)', async () => {
		const port = await start();
		expect(port).toBeGreaterThan(0);
	});

	test('GET /health returns 200 text/plain "ok"', async () => {
		const port = await start();
		const res = await fetch(`http://localhost:${port}/health`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/plain');
		expect(await res.text()).toBe('ok\n');
	});

	test('GET / (root) is also a 200 health response', async () => {
		const port = await start();
		const res = await fetch(`http://localhost:${port}/`);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('ok\n');
	});

	test('any other path is a 404 not-found', async () => {
		const port = await start();
		const res = await fetch(`http://localhost:${port}/metrics`);
		expect(res.status).toBe(404);
		expect(await res.text()).toBe('not found\n');
	});
});
