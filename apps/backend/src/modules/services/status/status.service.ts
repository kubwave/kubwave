import { Injectable } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import type { V1Deployment } from '@kubernetes/client-node';
import {
	LABEL_MANAGED_BY,
	LABEL_SERVICE_ID,
	MANAGED_BY_VALUE,
	deploymentRuntimeStatus,
	environmentNamespace,
	getKubeConfig,
	isNotFound,
	resourceName,
	unknownRuntime
} from '@kubwave/kube';
import type { ServiceRuntime } from '@kubwave/kube';
import { ServicesService } from '../services.service.js';

@Injectable()
export class ServiceStatusService {
	constructor(private readonly services: ServicesService) {}

	async getServiceRuntime(actingUserId: string, serviceId: string): Promise<ServiceRuntime> {
		const service = await this.services.getService(actingUserId, serviceId);

		try {
			const deployment = await this.readDeploymentOrNull(this.appsApi(), environmentNamespace(service.environmentId), resourceName(serviceId));
			return deploymentRuntimeStatus(deployment);
		} catch {
			return unknownRuntime();
		}
	}

	async listEnvironmentServiceRuntime(actingUserId: string, environmentId: string): Promise<Array<{ serviceId: string; runtime: ServiceRuntime }>> {
		const serviceList = await this.services.listServicesForEnvironment(actingUserId, environmentId);

		const byServiceId = new Map<string, V1Deployment>();
		let readFailed = false;

		try {
			const list = await this.appsApi().listNamespacedDeployment({
				namespace: environmentNamespace(environmentId),
				labelSelector: `${LABEL_MANAGED_BY}=${MANAGED_BY_VALUE}`
			});

			for (const deployment of list.items) {
				const id = deployment.metadata?.labels?.[LABEL_SERVICE_ID];
				if (id) byServiceId.set(id, deployment);
			}
		} catch (err) {
			if (!isNotFound(err)) readFailed = true;
		}

		return serviceList.map(service => ({
			serviceId: service.id,
			runtime: readFailed ? unknownRuntime() : deploymentRuntimeStatus(byServiceId.get(service.id) ?? null)
		}));
	}

	private appsApi(): k8s.AppsV1Api {
		return getKubeConfig().makeApiClient(k8s.AppsV1Api);
	}

	private async readDeploymentOrNull(api: k8s.AppsV1Api, namespace: string, name: string): Promise<V1Deployment | null> {
		try {
			return await api.readNamespacedDeployment({ name, namespace });
		} catch (err) {
			if (isNotFound(err)) return null;
			throw err;
		}
	}
}
