export class AgentApiError extends Error {
	constructor(readonly status: number) {
		super(`kubwave API returned ${status}`);
	}
}

export class AgentApi {
	constructor(
		private readonly baseUrl: string,
		private readonly token?: string
	) {
		const url = new URL(baseUrl);
		if (url.username || url.password || (url.protocol !== 'https:' && !['localhost', '127.0.0.1', 'console.localhost'].includes(url.hostname)))
			throw new Error('KUBWAVE_URL must use HTTPS');
	}
	async post<T>(path: string, body: unknown = {}): Promise<T> {
		const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/build-agent/${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(10_000),
			redirect: 'error'
		});
		if (!response.ok) throw new AgentApiError(response.status);
		return (await response.json()) as T;
	}
}
