import type { ServiceView, ServiceConfigView } from '../domain/service-config.js';
import type { ServiceViewDto } from '../generated/types.gen.js';

export interface KubwaveApiErrorBody {
	error: string;
	details?: unknown;
	status: number;
}

export type KubwaveApiResult<TData> =
	| {
			data: TData;
			error: null;
			request?: Request;
			response?: Response;
	  }
	| {
			data: null;
			error: KubwaveApiErrorBody;
			request?: Request;
			response?: Response;
	  };

export type NormalizeApiData<T> = T extends ServiceViewDto
	? ServiceView
	: T extends Array<infer TItem>
		? Array<NormalizeApiData<TItem>>
		: T extends { config: ServiceConfigView }
			? T
			: T;

export type ApiData<TPromise extends Promise<unknown>> = NormalizeApiData<
	Exclude<Awaited<TPromise> extends infer TResult ? (TResult extends { data: infer TData } ? TData : never) : never, null | undefined>
>;

export type ApiResult<TPromise extends Promise<unknown>> = KubwaveApiResult<ApiData<TPromise>>;

export async function apiResult<TPromise extends Promise<unknown>>(promise: TPromise): Promise<ApiResult<TPromise>> {
	try {
		const result = (await promise) as { data?: unknown; error?: unknown; request?: Request; response?: Response };
		if (result.error !== undefined && result.error !== null) {
			return {
				data: null,
				error: normalizeApiError(result.error, result.response),
				request: result.request,
				response: result.response
			} as ApiResult<TPromise>;
		}

		return {
			data: result.data as ApiData<TPromise>,
			error: null,
			request: result.request,
			response: result.response
		} as ApiResult<TPromise>;
	} catch (error) {
		return {
			data: null,
			error: normalizeApiError(error)
		} as ApiResult<TPromise>;
	}
}

export async function apiData<TPromise extends Promise<unknown>>(promise: TPromise): Promise<ApiData<TPromise>> {
	const result = await apiResult(promise);
	if (result.error) throw result.error;
	return result.data;
}

export function normalizeApiError(error: unknown, response?: Response): KubwaveApiErrorBody {
	const status = response?.status ?? 0;
	if (isApiErrorBody(error)) {
		return { ...error, status };
	}

	return {
		error: status === 0 ? 'network_error' : 'request_error',
		details: serializeErrorDetails(error),
		status
	};
}

function isApiErrorBody(error: unknown): error is { error: string; details?: unknown } {
	return typeof error === 'object' && error !== null && 'error' in error && typeof error.error === 'string';
}

function serializeErrorDetails(error: unknown): unknown {
	if (error instanceof Error) {
		return { name: error.name, message: error.message };
	}
	return error;
}
