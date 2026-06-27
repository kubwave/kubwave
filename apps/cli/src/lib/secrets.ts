import { randomBytes } from 'node:crypto';
import { CoreV1Api, type KubeConfig, type V1Secret } from '@kubernetes/client-node';
import * as p from '@clack/prompts';
import { APP_LABELS, APP_NAMESPACE, REGISTRY_HTPASSWD_SECRET_NAME, REGISTRY_PUSH_SECRET_NAME } from '~/lib/constants.js';
import { isNotFoundError } from '~/lib/k8s-errors.js';

export function generateSecret(bytes: number = 32): string {
	// base64url keeps the secret URL-safe for connection strings (e.g. DATABASE_URL).
	return randomBytes(bytes).toString('base64url');
}

export async function createSecrets(kc: KubeConfig, namespace: string = APP_NAMESPACE): Promise<void> {
	const api = kc.makeApiClient(CoreV1Api);

	const jwtSecret = generateSecret();
	const secretsKey = generateSecret();
	const postgresPassword = generateSecret();

	// console-creds (name kept for upgrade stability): JWT_SECRET + SECRETS_KEY.
	const consoleData: Record<string, string> = { JWT_SECRET: jwtSecret, SECRETS_KEY: secretsKey };

	await createSecretIfNotExists(api, {
		metadata: {
			name: 'console-creds',
			namespace,
			labels: APP_LABELS,
			annotations: { 'helm.sh/resource-policy': 'keep' }
		},
		type: 'Opaque',
		stringData: consoleData
	});

	// postgres-creds (api+worker) and postgres-app-creds (CNPG initdb) MUST share one password; reuse an existing postgres-creds so the bootstrap never drifts.
	const existingPg = await readSecretOrNull(api, 'postgres-creds', namespace);
	const encodedPw = existingPg?.data?.['POSTGRES_PASSWORD'];
	const pgPassword = encodedPw ? Buffer.from(encodedPw, 'base64').toString('utf8') : postgresPassword;

	await createSecretIfNotExists(api, {
		metadata: {
			name: 'postgres-creds',
			namespace,
			labels: APP_LABELS,
			annotations: { 'helm.sh/resource-policy': 'keep' }
		},
		type: 'Opaque',
		stringData: {
			POSTGRES_USER: 'app',
			POSTGRES_PASSWORD: pgPassword,
			POSTGRES_DB: 'kubwave'
		}
	});

	await createSecretIfNotExists(api, {
		metadata: {
			name: 'postgres-app-creds',
			namespace,
			labels: APP_LABELS,
			annotations: { 'helm.sh/resource-policy': 'keep' }
		},
		type: 'kubernetes.io/basic-auth',
		stringData: {
			username: 'app',
			password: pgPassword
		}
	});
}

async function createSecretIfNotExists(api: CoreV1Api, secret: V1Secret): Promise<void> {
	const name = secret.metadata!.name!;
	const namespace = secret.metadata!.namespace ?? APP_NAMESPACE;
	try {
		await api.readNamespacedSecret({ name, namespace });
		p.log.step(`Secret "${name}" already exists — skipped`);
	} catch (err: unknown) {
		if (isNotFoundError(err)) {
			await api.createNamespacedSecret({ namespace, body: secret });
			p.log.success(`Secret "${name}" created`);
		} else {
			throw err;
		}
	}
}

// One password, two forms: registry-htpasswd (bcrypt) + registry-creds (dockerconfigjson). Avoid rotating — it breaks already-distributed tenant pulls.
// htpasswd-missing → recover the password from creds; creds-missing is unrecoverable (bcrypt one-way), so regenerate both and let the worker re-sync.
export async function createRegistrySecrets(kc: KubeConfig, registryHost: string, namespace: string = APP_NAMESPACE): Promise<void> {
	const api = kc.makeApiClient(CoreV1Api);

	const existingHtpasswd = await readSecretOrNull(api, REGISTRY_HTPASSWD_SECRET_NAME, namespace);
	const existingDockerConfig = await readSecretOrNull(api, REGISTRY_PUSH_SECRET_NAME, namespace);
	if (existingHtpasswd && existingDockerConfig) {
		p.log.step('Registry secrets already exist — skipped');
		return;
	}

	const username = 'kubwave';
	const recoveredPassword = !existingHtpasswd && existingDockerConfig ? passwordFromDockerConfig(existingDockerConfig) : undefined;
	if (existingHtpasswd && !existingDockerConfig) {
		p.log.warn(
			`"${REGISTRY_PUSH_SECRET_NAME}" missing and the password cannot be recovered from the htpasswd — regenerating both; the worker will re-sync tenant pull secrets.`
		);
	}
	const password = recoveredPassword ?? generateSecret(24);
	const bcryptHash = await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 });

	await upsertSecret(api, {
		metadata: { name: REGISTRY_HTPASSWD_SECRET_NAME, namespace, labels: APP_LABELS, annotations: { 'helm.sh/resource-policy': 'keep' } },
		type: 'Opaque',
		stringData: { htpasswd: `${username}:${bcryptHash}` }
	});

	// Recovered password → the existing registry-creds is already correct; leave it untouched so distributed tenant pull secrets keep working.
	if (recoveredPassword) return;

	const dockerConfigJson = JSON.stringify({
		auths: {
			[registryHost]: { username, password, auth: Buffer.from(`${username}:${password}`).toString('base64') }
		}
	});
	await upsertSecret(api, {
		metadata: { name: REGISTRY_PUSH_SECRET_NAME, namespace, labels: APP_LABELS, annotations: { 'helm.sh/resource-policy': 'keep' } },
		type: 'kubernetes.io/dockerconfigjson',
		stringData: { '.dockerconfigjson': dockerConfigJson }
	});
}

// External-registry push cred (registry-creds, keyed on the host): BuildKit pushes, worker copies to tenants. Upserted so rotated creds update in place.
export async function createRegistryPushSecret(
	kc: KubeConfig,
	registryHost: string,
	username: string,
	password: string,
	namespace: string = APP_NAMESPACE
): Promise<void> {
	const api = kc.makeApiClient(CoreV1Api);
	const dockerConfigJson = JSON.stringify({
		auths: { [registryHost]: { username, password, auth: Buffer.from(`${username}:${password}`).toString('base64') } }
	});
	await upsertSecret(api, {
		metadata: { name: REGISTRY_PUSH_SECRET_NAME, namespace, labels: APP_LABELS, annotations: { 'helm.sh/resource-policy': 'keep' } },
		type: 'kubernetes.io/dockerconfigjson',
		stringData: { '.dockerconfigjson': dockerConfigJson }
	});
}

// Recover the registry password from an existing registry-creds dockerconfigjson so a missing htpasswd can be re-derived without rotating it.
function passwordFromDockerConfig(secret: V1Secret): string | undefined {
	const encoded = secret.data?.['.dockerconfigjson'];
	if (!encoded) return undefined;
	try {
		const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as {
			auths?: Record<string, { password?: string }>;
		};
		const entry = Object.values(parsed.auths ?? {}).find(auth => typeof auth.password === 'string' && auth.password.length > 0);
		return entry?.password;
	} catch {
		return undefined;
	}
}

async function readSecretOrNull(api: CoreV1Api, name: string, namespace: string): Promise<V1Secret | null> {
	try {
		return await api.readNamespacedSecret({ name, namespace });
	} catch (err: unknown) {
		if (isNotFoundError(err)) return null;
		throw err;
	}
}

async function upsertSecret(api: CoreV1Api, secret: V1Secret): Promise<void> {
	const name = secret.metadata!.name!;
	const namespace = secret.metadata!.namespace ?? APP_NAMESPACE;
	const existing = await readSecretOrNull(api, name, namespace);
	if (existing) {
		await api.replaceNamespacedSecret({ name, namespace, body: secret });
		p.log.step(`Secret "${name}" updated`);
		return;
	}
	await api.createNamespacedSecret({ namespace, body: secret });
	p.log.success(`Secret "${name}" created`);
}
