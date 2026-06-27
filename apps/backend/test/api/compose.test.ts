import { describe, expect, test } from 'bun:test';
import { internalServiceName } from '@kubwave/kube';
import { ComposeParseError } from '~/modules/services/compose/compose.errors';
import { parseComposeServices } from '~/modules/services/compose/compose.parser';
import { composeReferenceIssues, rewriteComposeServiceReferences } from '~/modules/services/compose/compose.references';

function parseIssues(compose: string): string[] {
	try {
		parseComposeServices(compose);
		throw new Error('expected parse to fail');
	} catch (err) {
		if (!(err instanceof ComposeParseError)) throw err;
		return err.issues;
	}
}

describe('Docker Compose import parser', () => {
	test('parses multiple image services with environment and ports', () => {
		expect(
			parseComposeServices(`
services:
  web:
    image: ghcr.io/acme/web:latest
    ports:
      - "8080:3000"
    environment:
      NODE_ENV: production
      FEATURE_FLAG: true
  worker:
    image: ghcr.io/acme/worker:1.2.3
    environment:
      - QUEUE=default
      - EMPTY_VALUE
`)
		).toEqual([
			{
				name: 'web',
				config: {
					image: 'ghcr.io/acme/web',
					tag: 'latest',
					containerPort: 3000,
					env: [
						{ key: 'NODE_ENV', value: 'production' },
						{ key: 'FEATURE_FLAG', value: 'true' }
					],
					domains: [],
					volumes: []
				}
			},
			{
				name: 'worker',
				config: {
					image: 'ghcr.io/acme/worker',
					tag: '1.2.3',
					containerPort: null,
					env: [
						{ key: 'QUEUE', value: 'default' },
						{ key: 'EMPTY_VALUE', value: '' }
					],
					domains: [],
					volumes: []
				}
			}
		]);
	});

	test('uses the first TCP container port and supports expose fallback', () => {
		const parsed = parseComposeServices(`
services:
  api:
    image: localhost:5000/acme/api:v1
    ports:
      - "9000:9000/udp"
      - "8080:80"
      - "8443:443"
  internal:
    image: redis:7
    expose:
      - "6379"
`);

		expect(parsed[0]?.config).toMatchObject({ image: 'localhost:5000/acme/api', tag: 'v1', containerPort: 80 });
		expect(parsed[1]?.config).toMatchObject({ image: 'redis', tag: '7', containerPort: 6379 });
		expect(parsed[1]?.config.defaultDomainEnabled).toBeUndefined();
	});

	test('parses short port form', () => {
		const parsed = parseComposeServices(`
services:
  web:
    image: nginx:1.27
    ports:
      - "80"
`);

		expect(parsed[0]?.config.containerPort).toBe(80);
	});

	test('defaults images without explicit tags to latest', () => {
		const parsed = parseComposeServices(`
services:
  web:
    image: nginx
  registry:
    image: localhost:5000/acme/api
`);

		expect(parsed[0]?.config).toMatchObject({ image: 'nginx', tag: 'latest' });
		expect(parsed[1]?.config).toMatchObject({ image: 'localhost:5000/acme/api', tag: 'latest' });
	});

	test('parses volumes from compose service', () => {
		expect(
			parseComposeServices(`
services:
  uptime-kuma:
    image: louislam/uptime-kuma:2
    restart: unless-stopped
    volumes:
      - ./data:/app/data
    ports:
      - "3001:3001"
`)
		).toEqual([
			{
				name: 'uptime-kuma',
				config: {
					image: 'louislam/uptime-kuma',
					tag: '2',
					containerPort: 3001,
					env: [],
					domains: [],
					volumes: [{ name: 'data', mountPath: '/app/data', size: '1Gi' }]
				}
			}
		]);
	});

	test('parses named volume, container-only path, and long-form volume', () => {
		expect(
			parseComposeServices(`
services:
  web:
    image: nginx:1.27
    volumes:
      - named-volume:/usr/share/nginx/html
      - /data
      - type: bind
        source: ./config
        target: /etc/nginx/conf.d
`)
		).toEqual([
			{
				name: 'web',
				config: {
					image: 'nginx',
					tag: '1.27',
					containerPort: null,
					env: [],
					domains: [],
					volumes: [
						{ name: 'named-volume', mountPath: '/usr/share/nginx/html', size: '1Gi' },
						{ name: 'volume-1', mountPath: '/data', size: '1Gi' },
						{ name: 'config', mountPath: '/etc/nginx/conf.d', size: '1Gi' }
					]
				}
			}
		]);
	});

	test('ignores unsupported service keys', () => {
		expect(
			parseComposeServices(`
services:
  web:
    image: nginx:1.27
    build: .
    depends_on:
      - db
    networks:
      - private
`)
		).toEqual([
			{
				name: 'web',
				config: {
					image: 'nginx',
					tag: '1.27',
					containerPort: null,
					env: [],
					domains: [],
					volumes: []
				}
			}
		]);
	});

	test('reports volume parse errors', () => {
		const issues = parseIssues(`
services:
  web:
    image: nginx:1.27
    volumes:
      - 42
`);
		expect(issues.join('\n')).toContain('volumes[0] must be a string or an object');
	});

	test('rejects duplicate names after trimming', () => {
		const issues = parseIssues(`
services:
  web:
    image: nginx:1.27
  " web ":
    image: nginx:1.28
`);

		expect(issues).toContain('Duplicate service name "web" in Compose file.');
	});

	test('rejects duplicate YAML service keys', () => {
		const issues = parseIssues(`
services:
  web:
    image: nginx:1.27
  web:
    image: nginx:1.28
`);

		expect(issues.join('\n')).toContain('Map keys must be unique');
	});

	test('rewrites exact service-name host env values to kubwave internal service names', () => {
		const parsed = parseComposeServices(`
services:
  db:
    image: mysql:8.4
    expose:
      - "3306"
  phpmyadmin:
    image: phpmyadmin:5
    environment:
      PMA_HOST: db
      MYSQL_PASSWORD: db
`);
		const rewritten = rewriteComposeServiceReferences(parsed, new Map([['db', '11111111-1111-4111-8111-111111111111']]));
		const phpmyadminEnv = rewritten.find(service => service.name === 'phpmyadmin')?.config.env;

		expect(phpmyadminEnv).toContainEqual({ key: 'PMA_HOST', value: internalServiceName('11111111-1111-4111-8111-111111111111') });
		expect(phpmyadminEnv).toContainEqual({ key: 'MYSQL_PASSWORD', value: 'db' });
	});

	test('reports service-name host references when the target has no internal endpoint', () => {
		const parsed = parseComposeServices(`
services:
  db:
    image: mysql:8.4
  phpmyadmin:
    image: phpmyadmin:5
    environment:
      PMA_HOST: db
`);

		expect(composeReferenceIssues(parsed)).toEqual([
			'services.phpmyadmin.environment.PMA_HOST references Compose service "db", but that service does not expose a port. Add a ports/expose entry to "db".'
		]);
	});
});
