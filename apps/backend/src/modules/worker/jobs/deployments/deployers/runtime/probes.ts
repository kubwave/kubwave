import type { V1Probe } from '@kubernetes/client-node';
import type { HealthCheckConfig, RuntimeConfig } from '@kubwave/db';

export function buildProbes(hc: HealthCheckConfig, port: number | null): { livenessProbe: V1Probe; readinessProbe: V1Probe } | null {
	if (!hc.enabled) return null;
	const probePort = hc.port ?? port ?? 0;
	if (probePort <= 0) return null;

	const base: V1Probe = {
		initialDelaySeconds: hc.initialDelaySeconds ?? 0,
		periodSeconds: hc.periodSeconds ?? 10,
		timeoutSeconds: hc.timeoutSeconds ?? 3,
		failureThreshold: hc.failureThreshold ?? 3
	};

	if (hc.type === 'http') {
		if (!hc.path) return null;
		base.httpGet = { path: hc.path, port: probePort };
	} else {
		base.tcpSocket = { port: probePort };
	}

	// K8s rejects a livenessProbe with successThreshold != 1 (422); it's meaningful only for readiness, so force liveness to 1.
	return {
		livenessProbe: { ...base, successThreshold: 1 },
		readinessProbe: { ...structuredClone(base), successThreshold: hc.successThreshold ?? 1 }
	};
}

export function probesMatch(container: { livenessProbe?: V1Probe; readinessProbe?: V1Probe }, config: RuntimeConfig): boolean {
	const desired = config.healthCheck ? buildProbes(config.healthCheck, config.containerPort) : null;
	if (!desired) return !container.livenessProbe && !container.readinessProbe;

	const l = container.livenessProbe;
	const r = container.readinessProbe;
	if (!l || !r) return false;

	// Compare only the action fields we set (http: path+port, tcp: port); raw object compare would diff on server defaults
	// (e.g. httpGet.scheme="HTTP") and re-write the Deployment every tick.
	const actionEqual = (a: V1Probe, b: V1Probe): boolean => {
		if (a.httpGet || b.httpGet) {
			return !!a.httpGet && !!b.httpGet && (a.httpGet.path ?? '') === (b.httpGet.path ?? '') && String(a.httpGet.port) === String(b.httpGet.port);
		}
		return !!a.tcpSocket && !!b.tcpSocket && String(a.tcpSocket.port) === String(b.tcpSocket.port);
	};

	const probeEqual = (a: V1Probe, b: V1Probe): boolean => {
		return (
			(a.initialDelaySeconds ?? 0) === (b.initialDelaySeconds ?? 0) &&
			(a.periodSeconds ?? 10) === (b.periodSeconds ?? 10) &&
			(a.timeoutSeconds ?? 3) === (b.timeoutSeconds ?? 3) &&
			(a.failureThreshold ?? 3) === (b.failureThreshold ?? 3) &&
			(a.successThreshold ?? 1) === (b.successThreshold ?? 1) &&
			actionEqual(a, b)
		);
	};

	return probeEqual(l, desired.livenessProbe) && probeEqual(r, desired.readinessProbe);
}
