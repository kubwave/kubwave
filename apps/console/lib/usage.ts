// One severity scale for every usage bar (cluster, nodes, volumes, service resources), so the same
// percentage reads the same everywhere.
export type Severity = 'unknown' | 'normal' | 'high' | 'critical';

export function usageSeverity(percent: number | null): Severity {
	if (percent == null) return 'unknown';
	if (percent >= 90) return 'critical';
	if (percent >= 75) return 'high';
	return 'normal';
}

export const SEVERITY_BAR: Record<Severity, string> = {
	unknown: 'bg-muted-foreground/40',
	normal: 'bg-primary',
	high: 'bg-warning',
	critical: 'bg-destructive'
};
