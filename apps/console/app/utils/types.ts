import type {
	DeploymentBuildLogsGetResponse,
	DeploymentLogsListResponse,
	EnvironmentFlowLayoutGetResponse,
	EnvVar,
	PlatformClusterEventsGetResponse,
	PlatformClusterGetResponse,
	PlatformClusterNodeGetResponse,
	PlatformClusterNodeUsageGetResponse,
	PlatformClusterUsageGetResponse,
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
export type ClusterSnapshot = PlatformClusterGetResponse;
export type ClusterNode = ClusterSnapshot['nodes'][number];
export type ClusterComponent = ClusterSnapshot['components'][number];
export type ClusterMeter = ClusterSnapshot['cpu'];
export type ClusterEvents = PlatformClusterEventsGetResponse;
export type ClusterEvent = ClusterEvents['events'][number];
export type ClusterUsage = PlatformClusterUsageGetResponse;
export type ClusterNodeDetail = PlatformClusterNodeGetResponse;
export type ClusterNodeCondition = ClusterNodeDetail['conditions'][number];
export type ClusterNodePod = ClusterNodeDetail['pods'][number];
export type ClusterNodeUsage = PlatformClusterNodeUsageGetResponse;
