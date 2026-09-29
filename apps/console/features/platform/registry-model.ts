import type { PlatformSettingsRegistryUpdateData, RegistrySettingsDto } from '@kubwave/api-client';

export type RegistryMode = 'platform' | 'external';
export type RegistryDraft = { mode: RegistryMode; endpoint: string; insecure: boolean; username: string; password: string };
export type RegistryPayload = PlatformSettingsRegistryUpdateData['body'];
export type RegistryErrors = Partial<Record<'endpoint' | 'username' | 'password', string>>;

// The stored password is write-only; the draft starts empty and an empty password keeps it.
export function registryDraftFrom(settings: RegistrySettingsDto): RegistryDraft {
	if (settings.mode !== 'external') return { mode: 'platform', endpoint: '', insecure: false, username: '', password: '' };
	return { mode: 'external', endpoint: settings.endpoint ?? '', insecure: settings.insecure, username: settings.username ?? '', password: '' };
}

export function registryErrors(draft: RegistryDraft, hasStoredPassword: boolean): RegistryErrors {
	if (draft.mode === 'platform') return {};
	const errors: RegistryErrors = {};
	if (!draft.endpoint.trim()) errors.endpoint = 'Enter the registry endpoint.';
	if (!draft.username.trim()) errors.username = 'Enter a username.';
	if (!draft.password && !hasStoredPassword) errors.password = 'Enter a password or token.';
	return errors;
}

export function registryPayload(draft: RegistryDraft): RegistryPayload {
	if (draft.mode === 'platform') return { mode: 'platform' };
	return {
		mode: 'external',
		endpoint: draft.endpoint.trim(),
		insecure: draft.insecure,
		username: draft.username.trim(),
		...(draft.password ? { password: draft.password } : {})
	};
}

// Poll while the platform rolls the registry out; stop once it settles.
export function registryPollInterval(settings: RegistrySettingsDto | undefined): number | false {
	return settings?.applyStatus === 'pending' || settings?.applyStatus === 'applying' ? 3000 : false;
}
