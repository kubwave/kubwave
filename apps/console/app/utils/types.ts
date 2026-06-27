import type {
	DeploymentBuildLogsGetResponse,
	DeploymentLogsListResponse,
	EnvironmentFlowLayoutGetResponse,
	EnvVar,
	ProjectDetailDto,
	ServiceDeploymentsListResponse,
	ServiceLogsGetResponse,
	ServiceMetricsGetResponse,
	ServiceStatusGetResponse,
	ServiceView,
	TeamMembersListResponse,
	TeamSshKeysListResponse
} from '@kubwave/api-client';

export type ProjectDetail = ProjectDetailDto;
export type Environment = ProjectDetail['environments'][number];
export type Service = ServiceView;
export type FlowLayout = EnvironmentFlowLayoutGetResponse;
export type FlowLayoutNode = FlowLayout['nodes'][number];
export type FlowNodePosition = FlowLayoutNode['position'];
export type ServiceConfig = Service['config'];
export type { EnvVar };
export type ServiceRuntime = ServiceStatusGetResponse;
export type ServiceMetrics = ServiceMetricsGetResponse;
export type ServiceLogs = ServiceLogsGetResponse;
export type ServiceLogEntry = ServiceLogs['entries'][number];
export type Deployment = ServiceDeploymentsListResponse[number];
export type DeploymentEventLogs = DeploymentLogsListResponse;
export type DeploymentLog = DeploymentEventLogs['logs'][number];
export type DeploymentBuildLogs = DeploymentBuildLogsGetResponse;
export type DeploymentBuildLogContainer = DeploymentBuildLogs['containers'][number];
export type TeamMember = TeamMembersListResponse[number];
export type SshKey = TeamSshKeysListResponse[number];
