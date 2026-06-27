import { afterEach, describe, expect, test } from 'bun:test';
import { apiData, createKubwaveClient, createKubwaveFetch, createResourceClient, type KubwaveRawClient } from '../src/index';

describe('createKubwaveClient', () => {
	test('normalizes trailing slash from baseUrl', () => {
		const client = createKubwaveClient({ baseUrl: 'http://localhost:3001/' });
		expect(client.baseUrl).toBe('http://localhost:3001');
	});
});

describe('createResourceClient', () => {
	test('returns data/error results and binds path params', async () => {
		let options: unknown;
		const raw = {
			teamProjectsList: async (input: unknown) => {
				options = input;
				return { data: [{ id: 'project_1', name: 'Core' }], error: undefined };
			}
		} as KubwaveRawClient;

		const result = await createResourceClient(raw).teams('team_1').projects.get();

		expect(options).toEqual({ path: { teamId: 'team_1' } });
		expect(result.error).toBeNull();
		expect(result.data).toEqual([{ id: 'project_1', name: 'Core' }]);
	});

	test('passes body payloads to the raw generated operation', async () => {
		let options: unknown;
		const raw = {
			teamProjectsCreate: async (input: unknown) => {
				options = input;
				return { data: { id: 'project_1', name: 'Core' }, error: undefined };
			}
		} as KubwaveRawClient;

		await createResourceClient(raw).teams('team_1').projects.post({ name: 'Core' });

		expect(options).toEqual({ path: { teamId: 'team_1' }, body: { name: 'Core' } });
	});

	test('normalizes API errors with status', async () => {
		const response = new Response(null, { status: 404 });
		const raw = {
			projectsGet: async () => ({ data: undefined, error: { error: 'project_not_found' }, response })
		} as KubwaveRawClient;

		const result = await createResourceClient(raw).projects('project_1').get();

		expect(result.data).toBeNull();
		expect(result.error).toEqual({ error: 'project_not_found', status: 404 });
	});

	test('keeps apiData as a throwing unwrap helper', async () => {
		const raw = {
			projectsGet: async () => ({ data: { id: 'project_1', name: 'Core' }, error: undefined })
		} as KubwaveRawClient;

		const project = await apiData(createResourceClient(raw).projects('project_1').get());

		expect(project).toEqual({ id: 'project_1', name: 'Core' });
	});
});

describe('createKubwaveFetch', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	// The generated client passes a pre-built Request whose headers carry Content-Type.
	// `new Request(req, { headers })` replaces that header list, so a naive wrapper drops
	// Content-Type (browsers even drop it for an empty Headers init) -> POST bodies 415.
	function captureSentRequest(): () => Request | undefined {
		let sent: Request | undefined;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			sent = new Request(input as Request, init);
			return new Response(null, { status: 200 });
		}) as typeof fetch;
		return () => sent;
	}

	function jsonPost(): Request {
		return new Request('http://api.test/setup/initialize', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'Ada' })
		});
	}

	test('preserves the request Content-Type while attaching the bearer token', async () => {
		const sent = captureSentRequest();
		const kubwaveFetch = createKubwaveFetch({ baseUrl: '', getAccessToken: () => 'tok' });

		await kubwaveFetch(jsonPost());

		expect(sent()?.headers.get('Content-Type')).toBe('application/json');
		expect(sent()?.headers.get('Authorization')).toBe('Bearer tok');
	});

	test('preserves the request Content-Type for unauthenticated calls (setup flow)', async () => {
		const sent = captureSentRequest();
		const kubwaveFetch = createKubwaveFetch({ baseUrl: '' });

		await kubwaveFetch(jsonPost());

		expect(sent()?.headers.get('Content-Type')).toBe('application/json');
		expect(sent()?.headers.get('Authorization')).toBeNull();
	});

	test('accepts a plain URL input without fabricating a Content-Type', async () => {
		const sent = captureSentRequest();
		const kubwaveFetch = createKubwaveFetch({ baseUrl: '', getAccessToken: () => 'tok' });

		await kubwaveFetch('http://api.test/teams', { method: 'GET' });

		expect(sent()?.headers.get('Content-Type')).toBeNull();
		expect(sent()?.headers.get('Authorization')).toBe('Bearer tok');
	});
});
