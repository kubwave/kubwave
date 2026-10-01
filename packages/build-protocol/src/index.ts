export type { V1Container as BuildContainer } from '@kubernetes/client-node';
import type { V1Job } from '@kubernetes/client-node';

export const BUILD_PROTOCOL_VERSION = 1;
export const AGENT_LEASE_SECONDS = 90;
export const AGENT_HEARTBEAT_MS = 10_000;

export interface BuildPayload {
	job: V1Job;
	files: Record<string, Record<string, string>>;
	redactions: string[];
	imageRef: string;
}

export interface AgentTask extends BuildPayload {
	id: string;
	attempt: number;
	leaseToken: string;
	leaseExpiresAt: string;
	timeoutSeconds: number;
}

export interface AgentLogLine {
	sequence: number;
	container: string;
	message: string;
	ts: string;
}

export function safeBuildFilePath(path: string): string {
	if (
		!path ||
		path.startsWith('/') ||
		path.includes('\\') ||
		path.includes('\0') ||
		path.split('/').some(part => part === '..' || part === '.' || part === '')
	)
		throw new Error('Invalid build file path');
	return path;
}

export function redactBuildLog(message: string, secrets: readonly string[]): string {
	return secrets.filter(secret => secret.length >= 4).reduce((line, secret) => line.split(secret).join('[REDACTED]'), message);
}
