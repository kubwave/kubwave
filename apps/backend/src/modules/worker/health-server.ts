import { createServer, type Server } from 'node:http';

export function startWorkerHealthServer(port: number): Server {
	const server = createServer((request, response) => {
		const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;
		if (pathname === '/health' || pathname === '/') {
			response.writeHead(200, { 'content-type': 'text/plain' });
			response.end('ok\n');
			return;
		}
		response.writeHead(404, { 'content-type': 'text/plain' });
		response.end('not found\n');
	});

	server.listen(port, '0.0.0.0');
	return server;
}
