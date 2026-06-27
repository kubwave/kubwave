// Liveness/readiness probe for the console pod; auth-exempt so it never redirects.
export default defineEventHandler(event => {
	setResponseHeader(event, 'content-type', 'text/plain');
	return 'ok\n';
});
