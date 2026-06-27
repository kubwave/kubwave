export class ApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		public readonly details?: unknown
	) {
		super(code);
		this.name = 'ApiError';
	}
}
