import { Global, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminGuard, AuthGuard } from './auth/auth.guard.js';
import { PasswordService } from './auth/password.service.js';
import { TokenService } from './auth/token.service.js';
import { BackendConfigService } from './config/backend-config.service.js';
import { CookieService } from './cookies/cookie.service.js';
import { MailerService } from './mailer/mailer.service.js';
import { MetricsConfigService } from './metrics/metrics-config.service.js';
import { SettingsService } from './settings/settings.service.js';
import { AuthRateLimitGuard } from './throttler/auth-rate-limit.guard.js';

@Global()
@Module({
	imports: [
		ThrottlerModule.forRootAsync({
			inject: [BackendConfigService],
			useFactory: (config: BackendConfigService) => {
				const { windowSec, limit } = config.throttler;
				// Parity with the legacy limiter: a non-positive limit disables throttling (passthrough).
				return { throttlers: [{ ttl: windowSec * 1000, limit }], skipIf: () => limit <= 0 };
			}
		})
	],
	providers: [
		BackendConfigService,
		CookieService,
		PasswordService,
		TokenService,
		AuthGuard,
		AdminGuard,
		SettingsService,
		MailerService,
		MetricsConfigService,
		AuthRateLimitGuard
	],
	exports: [
		BackendConfigService,
		CookieService,
		PasswordService,
		TokenService,
		AuthGuard,
		AdminGuard,
		SettingsService,
		MailerService,
		MetricsConfigService,
		AuthRateLimitGuard
	]
})
export class SharedModule {}
