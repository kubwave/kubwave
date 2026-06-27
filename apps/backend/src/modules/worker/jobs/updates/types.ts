export type UpdateRunStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export const ACTIVE_UPDATE_RUN_STATUSES: readonly UpdateRunStatus[] = ['pending', 'running'];
