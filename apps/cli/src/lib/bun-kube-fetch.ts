import https from 'node:https';
import { IsomorphicFetchHttpLibrary } from '@kubernetes/client-node/dist/gen/http/isomorphic-fetch.js';
import { ResponseContext } from '@kubernetes/client-node/dist/gen/http/http.js';
import { from } from '@kubernetes/client-node/dist/gen/rxjsStub.js';

type BunFetchTls = {
	rejectUnauthorized?: boolean;
	ca?: Buffer | Buffer[];
	cert?: Buffer | Buffer[];
	key?: Buffer | Buffer[];
	servername?: string;
};

declare global {
	// eslint-disable-next-line no-var
	var __KUBWAVE_KUBE_FETCH_PATCHED: boolean | undefined;
}

export function tlsFromHttpsAgent(agent?: https.Agent): BunFetchTls | undefined {
	const opts = agent?.options;
	if (!opts?.ca && !opts?.cert && !opts?.key && opts?.rejectUnauthorized !== false && !opts?.servername) return undefined;
	return {
		...(opts.ca ? { ca: opts.ca } : {}),
		...(opts.cert ? { cert: opts.cert } : {}),
		...(opts.key ? { key: opts.key } : {}),
		...(opts.servername ? { servername: opts.servername } : {}),
		...(opts.rejectUnauthorized !== undefined ? { rejectUnauthorized: opts.rejectUnauthorized } : {})
	} as BunFetchTls;
}

// Bun's built-in node-fetch ignores https.Agent client certs; inject Bun fetch `tls` instead.
export function ensureBunKubeFetchPatch(): void {
	if (!process.versions.bun || globalThis.__KUBWAVE_KUBE_FETCH_PATCHED) return;
	globalThis.__KUBWAVE_KUBE_FETCH_PATCHED = true;

	const bunFetch = globalThis.fetch.bind(globalThis);
	IsomorphicFetchHttpLibrary.prototype.send = function (request) {
		const method = request.getHttpMethod().toString();
		const body = request.getBody();
		const agent = request.getAgent() as https.Agent | undefined;
		const tls = tlsFromHttpsAgent(agent);
		const init: RequestInit & { tls?: BunFetchTls; agent?: https.Agent } = {
			method,
			body: body as BodyInit | null | undefined,
			headers: request.getHeaders(),
			signal: request.getSignal()
		};
		if (tls) init.tls = tls;
		else if (agent) init.agent = agent;

		const resultPromise = bunFetch(request.getUrl(), init).then(resp => {
			const headers: Record<string, string> = {};
			resp.headers.forEach((value, name) => {
				headers[name] = value;
			});
			const responseBody = {
				text: () => resp.text(),
				binary: () => resp.arrayBuffer().then(buf => Buffer.from(buf))
			};
			return new ResponseContext(resp.status, headers, responseBody);
		});
		return from(resultPromise);
	};
}
