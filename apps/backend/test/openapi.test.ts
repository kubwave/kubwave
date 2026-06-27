import { beforeAll, describe, expect, test } from 'bun:test';

process.env.JWT_SECRET ??= 'test-secret';
process.env.DATABASE_URL ??= 'postgres://u:p@localhost:5432/test';

interface OpenApiOperation {
	operationId?: string;
	security?: Array<Record<string, string[]>>;
}

interface OpenApiSpec {
	components?: {
		securitySchemes?: Record<string, unknown>;
	};
	paths: Record<string, Record<string, OpenApiOperation>>;
}

let spec: OpenApiSpec;

beforeAll(async () => {
	const { createApiApp } = await import('../src/app.factory.js');
	const { createOpenApiDocument } = await import('../src/shared/openapi/openapi.js');
	const app = await createApiApp();
	try {
		spec = createOpenApiDocument(app) as unknown as OpenApiSpec;
	} finally {
		await app.close();
	}
});

function operation(path: string, method: string): OpenApiOperation {
	const op = spec.paths[path]?.[method];
	expect(op).toBeDefined();
	return op!;
}

describe('Nest OpenAPI contract', () => {
	test('registers bearer auth', () => {
		expect(spec.components?.securitySchemes?.bearerAuth).toEqual({
			type: 'http',
			scheme: 'bearer',
			bearerFormat: 'JWT'
		});
	});

	test('uses stable operation ids for generated clients', () => {
		expect(operation('/api/auth/login', 'post').operationId).toBe('authLogin');
		expect(operation('/api/auth/session', 'get').operationId).toBe('authSession');
		expect(operation('/api/setup/status', 'get').operationId).toBe('setupStatus');
		expect(operation('/api/setup/initialize', 'post').operationId).toBe('setupInitialize');
		expect(operation('/api/teams', 'get').operationId).toBe('teamsList');
		expect(operation('/api/teams', 'post').operationId).toBe('teamsCreate');
		expect(operation('/api/teams/active', 'put').operationId).toBe('teamsSetActive');
		expect(operation('/api/teams/{teamId}/members', 'get').operationId).toBe('teamMembersList');
		expect(operation('/api/teams/{teamId}/members/{userId}', 'patch').operationId).toBe('teamMembersUpdateRole');
		expect(operation('/api/teams/{teamId}/ssh-keys', 'get').operationId).toBe('teamSshKeysList');
		expect(operation('/api/teams/{teamId}/ssh-keys', 'post').operationId).toBe('teamSshKeysCreate');
		expect(operation('/api/teams/{teamId}/ssh-keys/{keyId}', 'delete').operationId).toBe('teamSshKeysDelete');
		expect(operation('/api/teams/{teamId}/projects', 'get').operationId).toBe('teamProjectsList');
		expect(operation('/api/teams/{teamId}/projects', 'post').operationId).toBe('teamProjectsCreate');
		expect(operation('/api/projects/{projectId}/environments', 'post').operationId).toBe('projectEnvironmentsCreate');
		expect(operation('/api/projects/{projectId}', 'get').operationId).toBe('projectsGet');
		expect(operation('/api/projects/{projectId}', 'patch').operationId).toBe('projectsUpdate');
		expect(operation('/api/projects/{projectId}/pr-previews', 'patch').operationId).toBe('projectsSetPrPreviews');
		expect(operation('/api/environments/{environmentId}', 'patch').operationId).toBe('environmentsUpdate');
		expect(operation('/api/environments/{environmentId}', 'delete').operationId).toBe('environmentsDelete');
		expect(operation('/api/environments/{environmentId}/flow-layout', 'get').operationId).toBe('environmentFlowLayoutGet');
		expect(operation('/api/environments/{environmentId}/flow-layout/nodes/{serviceId}', 'patch').operationId).toBe('environmentFlowLayoutNodeUpdate');
		expect(operation('/api/environments/{environmentId}/services', 'get').operationId).toBe('environmentServicesList');
		expect(operation('/api/environments/{environmentId}/services', 'post').operationId).toBe('environmentServicesCreate');
		expect(operation('/api/services/{serviceId}', 'get').operationId).toBe('servicesGet');
		expect(operation('/api/services/{serviceId}', 'patch').operationId).toBe('servicesUpdate');
		expect(operation('/api/services/{serviceId}', 'delete').operationId).toBe('servicesDelete');
		expect(operation('/api/services/{serviceId}/connection', 'get').operationId).toBe('servicesConnectionGet');
		expect(operation('/api/services/{serviceId}/status', 'get').operationId).toBe('serviceStatusGet');
		expect(operation('/api/services/{serviceId}/logs', 'get').operationId).toBe('serviceLogsGet');
		expect(operation('/api/services/{serviceId}/metrics', 'get').operationId).toBe('serviceMetricsGet');
		expect(operation('/api/environments/{environmentId}/services/status', 'get').operationId).toBe('environmentServiceStatusList');
		expect(operation('/api/environments/{environmentId}/services/compose', 'post').operationId).toBe('environmentServicesComposeCreate');
		expect(operation('/api/services/{serviceId}/deployments', 'get').operationId).toBe('serviceDeploymentsList');
		expect(operation('/api/services/{serviceId}/deployments', 'post').operationId).toBe('serviceDeploymentsEnqueue');
		expect(operation('/api/deployments/{deploymentId}', 'get').operationId).toBe('deploymentsGet');
		expect(operation('/api/deployments/{deploymentId}/logs', 'get').operationId).toBe('deploymentLogsList');
		expect(operation('/api/deployments/{deploymentId}/build-logs', 'get').operationId).toBe('deploymentBuildLogsGet');
		expect(operation('/api/deployments/{deploymentId}/cancel', 'post').operationId).toBe('deploymentsCancel');
		expect(operation('/api/invitations', 'get').operationId).toBe('invitationsList');
		expect(operation('/api/invitations', 'post').operationId).toBe('invitationsCreate');
		expect(operation('/api/invitations/{id}', 'delete').operationId).toBe('invitationsDelete');
		expect(operation('/api/invitations/{id}/resend', 'post').operationId).toBe('invitationsResend');
		expect(operation('/api/invitations/{id}/validity', 'get').operationId).toBe('invitationsValidity');
		expect(operation('/api/invitations/{id}/accept', 'post').operationId).toBe('invitationsAccept');
		expect(operation('/api/platform/version', 'get').operationId).toBe('platformVersionGet');
		expect(operation('/api/platform/version/check', 'post').operationId).toBe('platformVersionCheck');
		expect(operation('/api/platform/updates', 'get').operationId).toBe('platformUpdatesList');
		expect(operation('/api/platform/updates', 'post').operationId).toBe('platformUpdatesTrigger');
		expect(operation('/api/platform/updates/{id}', 'get').operationId).toBe('platformUpdatesGet');
		expect(operation('/api/platform/updates/{id}/logs', 'get').operationId).toBe('platformUpdateLogsGet');
		expect(operation('/api/platform/users', 'get').operationId).toBe('platformUsersList');
		expect(operation('/api/platform/users/{id}', 'patch').operationId).toBe('platformUsersUpdate');
		expect(operation('/api/platform/users/{id}', 'delete').operationId).toBe('platformUsersDelete');
		expect(operation('/api/platform/settings/domain', 'get').operationId).toBe('platformSettingsDomainGet');
		expect(operation('/api/platform/settings/domain', 'put').operationId).toBe('platformSettingsDomainUpdate');
		expect(operation('/api/platform/settings/smtp', 'get').operationId).toBe('platformSettingsSmtpGet');
		expect(operation('/api/platform/settings/smtp', 'put').operationId).toBe('platformSettingsSmtpUpdate');
		expect(operation('/api/platform/settings/smtp/test', 'post').operationId).toBe('platformSettingsSmtpTest');
		expect(operation('/api/platform/settings/registry', 'get').operationId).toBe('platformSettingsRegistryGet');
		expect(operation('/api/platform/settings/registry', 'put').operationId).toBe('platformSettingsRegistryUpdate');
		expect(operation('/api/platform/settings/metrics', 'get').operationId).toBe('platformSettingsMetricsGet');
		expect(operation('/api/platform/settings/metrics', 'put').operationId).toBe('platformSettingsMetricsUpdate');
		expect(operation('/api/platform/settings/pr-previews', 'get').operationId).toBe('platformSettingsPrPreviewsGet');
		expect(operation('/api/platform/settings/pr-previews', 'put').operationId).toBe('platformSettingsPrPreviewsUpdate');
		expect(operation('/api/platform/settings/ha', 'get').operationId).toBe('platformSettingsHaGet');
		expect(operation('/api/platform/settings/ha', 'put').operationId).toBe('platformSettingsHaUpdate');
		expect(operation('/api/platform/settings/deployment-concurrency', 'get').operationId).toBe('platformSettingsDeploymentConcurrencyGet');
		expect(operation('/api/platform/settings/deployment-concurrency', 'put').operationId).toBe('platformSettingsDeploymentConcurrencyUpdate');
		expect(operation('/api/platform/settings/volume-autoscaling', 'get').operationId).toBe('platformSettingsVolumeAutoscalingGet');
		expect(operation('/api/platform/settings/volume-autoscaling', 'put').operationId).toBe('platformSettingsVolumeAutoscalingUpdate');
		expect(operation('/api/platform/settings/platform-volumes', 'get').operationId).toBe('platformSettingsPlatformVolumesGet');
		expect(spec.paths['/api/environments/{environmentId}/flow-layout/ws']).toBeUndefined();
	});

	test('marks protected routes with bearer security', () => {
		expect(operation('/api/auth/session', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/teams', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/teams/{teamId}/members', 'post').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/teams/{teamId}/ssh-keys', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/teams/{teamId}/ssh-keys/{keyId}', 'delete').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/teams/{teamId}/projects', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/projects/{projectId}/environments', 'post').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/projects/{projectId}', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/environments/{environmentId}', 'patch').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/environments/{environmentId}', 'delete').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/environments/{environmentId}/flow-layout', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/environments/{environmentId}/flow-layout/nodes/{serviceId}', 'patch').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/environments/{environmentId}/services', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/services/{serviceId}', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/services/{serviceId}/connection', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/services/{serviceId}/status', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/services/{serviceId}/logs', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/services/{serviceId}/metrics', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/environments/{environmentId}/services/status', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/environments/{environmentId}/services/compose', 'post').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/services/{serviceId}/deployments', 'post').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/deployments/{deploymentId}', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/deployments/{deploymentId}/cancel', 'post').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/invitations', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/invitations/{id}/resend', 'post').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/invitations/{id}/validity', 'get').security).toBeUndefined();
		expect(operation('/api/invitations/{id}/accept', 'post').security).toBeUndefined();
		expect(operation('/api/platform/version', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/platform/version/check', 'post').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/platform/updates', 'post').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/platform/updates/{id}/logs', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/platform/users', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/platform/users/{id}', 'delete').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/platform/settings/domain', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/platform/settings/domain', 'put').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/platform/settings/smtp/test', 'post').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/platform/settings/registry', 'put').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/platform/settings/metrics', 'put').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/platform/settings/pr-previews', 'put').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/platform/settings/ha', 'put').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/platform/settings/deployment-concurrency', 'put').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/platform/settings/volume-autoscaling', 'put').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/platform/settings/platform-volumes', 'get').security).toEqual([{ bearerAuth: [] }]);
	});
});
