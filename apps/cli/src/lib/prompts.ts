import * as p from '@clack/prompts';
import { FatalCliError, UserCancelledError } from '~/lib/errors.js';

const FQDN_RE = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InstallInputs {
	domain: string;
	email: string;
}

// Call before any cluster mutation; the --domain/--email flag path bypasses the interactive validate() below.
export function assertValidInstallFlags(flags: { domain?: string; email?: string }): void {
	if (flags.domain !== undefined && !FQDN_RE.test(flags.domain)) {
		throw new FatalCliError(`Invalid --domain "${flags.domain}": must be a valid FQDN (e.g. app.example.com).`);
	}
	if (flags.email !== undefined && !EMAIL_RE.test(flags.email)) {
		throw new FatalCliError(`Invalid --email "${flags.email}": must be a valid email address.`);
	}
}

export async function promptInstallInputs(flags: { domain?: string; email?: string }): Promise<InstallInputs> {
	const domain =
		flags.domain ??
		(await p.text({
			message: 'Domain for the console (e.g. app.example.com)',
			placeholder: 'app.example.com',
			validate(value) {
				if (!FQDN_RE.test(value ?? '')) return 'Please enter a valid FQDN (e.g. app.example.com)';
			}
		}));

	if (p.isCancel(domain)) {
		throw new UserCancelledError('Installation aborted.');
	}

	const email =
		flags.email ??
		(await p.text({
			message: "Email for Let's Encrypt ACME (for TLS certificates)",
			placeholder: 'ops@example.com',
			validate(value) {
				if (!EMAIL_RE.test(value ?? '')) return 'Please enter a valid email address';
			}
		}));

	if (p.isCancel(email)) {
		throw new UserCancelledError('Installation aborted.');
	}

	const inputs = { domain: domain as string, email: email as string };
	assertValidInstallFlags(inputs);
	return inputs;
}
