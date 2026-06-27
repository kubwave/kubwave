import { ApiError } from '../../../shared/errors/api-error.js';
import type { FlowLayoutNodeDto } from './flow-layout.dto.js';

export class FlowLayoutConflictError extends ApiError {
	constructor(current: FlowLayoutNodeDto | null) {
		super(409, 'flow_layout_conflict', { current });
	}
}
