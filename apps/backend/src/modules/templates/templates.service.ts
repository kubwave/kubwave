import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { generatePassword, signJwtHs256 } from '@kubwave/crypto';
import { internalServiceName } from '@kubwave/kube';
import { ApiError } from '../../shared/errors/api-error.js';
import { ServicesService } from '../services/services.service.js';
import type { CreateServiceInput } from '../services/services.dto.js';
import type { ServiceView } from '../services/services.types.js';
import { TemplateCatalogService } from './template-catalog.service.js';
import { resolveTemplateServiceConfig, type ResolveContext } from './template-placeholder.js';

@Injectable()
export class TemplatesService {
	constructor(
		private readonly catalog: TemplateCatalogService,
		private readonly services: ServicesService
	) {}

	async instantiate(
		actingUserId: string,
		environmentId: string,
		templateId: string,
		instanceName: string | undefined,
		inputs: Record<string, string>
	): Promise<ServiceView[]> {
		const template = await this.catalog.getTemplate(templateId);
		if (!template) throw new ApiError(404, 'template_not_found');

		const resolvedInputs: Record<string, string> = {};
		for (const input of template.inputs) {
			const value = inputs[input.key] ?? input.default ?? '';
			if (input.required && value.trim() === '') throw new ApiError(400, 'template_input_required');
			if (value.length > 2000) throw new ApiError(400, 'template_input_invalid');
			resolvedInputs[input.key] = value;
		}

		// A jwt secret signs with an earlier secret's value; catalog build validates declaration order, so the signing key already exists here.
		const secrets: Record<string, string> = {};
		for (const secret of template.secrets) {
			if (secret.generate === 'jwt') {
				const signingKey = secrets[secret.signWith];
				if (signingKey === undefined) throw new ApiError(500, 'template_invalid');
				const iat = Math.floor(Date.now() / 1000);
				const exp = iat + secret.expiresInDays * 86400;
				secrets[secret.key] = signJwtHs256({ ...secret.claims, iat, exp }, signingKey);
			} else {
				secrets[secret.key] = generatePassword();
			}
		}

		// Derive final, environment-unique names; primary keeps the base name, others get a suffix.
		const base = (instanceName ?? template.id).trim();
		const finalNames = template.services.map(svc => (svc.primary ? base : `${base}-${svc.name}`));

		// Intra-batch collision guard: two services in the same template must not derive the same name.
		if (new Set(finalNames).size !== finalNames.length) throw new ApiError(409, 'service_name_taken');

		// Pre-flight collision check so a multi-service template fails before creating anything.
		const existing = new Set((await this.services.listServicesForEnvironment(actingUserId, environmentId)).map(s => s.name));
		for (const name of finalNames) {
			if (existing.has(name)) throw new ApiError(409, 'service_name_taken');
		}

		// Pre-generate service IDs so {{ services.<name>.host }} references resolve in any order, including cycles — the host is deterministic from the id.
		const serviceIds = template.services.map(() => randomUUID());
		const ctx: ResolveContext = { secrets, inputs: resolvedInputs, services: {} };
		for (let i = 0; i < template.services.length; i++) {
			ctx.services[template.services[i]!.name] = { host: internalServiceName(serviceIds[i]!) };
		}

		const created: ServiceView[] = [];
		for (let i = 0; i < template.services.length; i++) {
			const tmplService = template.services[i]!;
			const config = resolveTemplateServiceConfig(tmplService.config, ctx);
			const input: CreateServiceInput = {
				name: finalNames[i]!,
				type: 'docker-image',
				config: {
					image: config.image,
					tag: config.tag,
					containerPort: config.containerPort,
					...(config.defaultDomainEnabled === true ? { defaultDomainEnabled: true } : {}),
					env: config.env,
					secrets: config.secrets,
					domains: config.domains,
					volumes: config.volumes,
					configFiles: config.configFiles,
					...(config.command ? { command: config.command } : {}),
					...(config.args ? { args: config.args } : {})
				}
			};
			const service = await this.services.createService(actingUserId, environmentId, input, serviceIds[i]!);
			created.push(service);
		}

		return created;
	}
}
