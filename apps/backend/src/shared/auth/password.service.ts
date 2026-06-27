import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService {
	hash(plain: string): Promise<string> {
		// Pinned to Bun's previous argon2id defaults (m=65536,t=2,p=1) so hashes created
		// after the migration keep parity with the prior Bun.password.hash output.
		return argon2.hash(plain, { type: argon2.argon2id, memoryCost: 65536, timeCost: 2, parallelism: 1 });
	}

	verify(hash: string, plain: string): Promise<boolean> {
		return argon2.verify(hash, plain);
	}
}
