export interface AppJwtClaims {
	iat: number;
	exp: number;
	iss: string;
}

// iat is back-dated 60s to tolerate clock skew against GitHub; exp stays within GitHub's 10-min cap. iss is the App id.
export function buildAppJwtClaims(appId: string, nowSeconds: number): AppJwtClaims {
	return { iat: nowSeconds - 60, exp: nowSeconds + 9 * 60, iss: appId };
}

// Reuse a cached installation token until `skewMs` before expiry, so an in-flight clone never gets a token about to lapse.
export function tokenIsFresh(expiresAtMs: number, nowMs: number, skewMs = 5 * 60_000): boolean {
	return expiresAtMs - skewMs > nowMs;
}
