import { describe, expect, test } from 'bun:test';
import { parseDotenv } from '../app/utils/parse-dotenv';

describe('parseDotenv', () => {
	test('parses plain, exported, and commented lines', () => {
		const text = ['# comment', '', 'PORT=3000', 'export NODE_ENV = production', 'LOG_LEVEL=info # verbose later', 'URL=http://x#anchor'].join('\n');
		expect(parseDotenv(text)).toEqual([
			{ key: 'PORT', value: '3000' },
			{ key: 'NODE_ENV', value: 'production' },
			{ key: 'LOG_LEVEL', value: 'info' },
			{ key: 'URL', value: 'http://x#anchor' }
		]);
	});

	test('handles quoted and multiline values', () => {
		const text = ['A="hello # not a comment"', "B='single $literal'", 'C="line1\\nline2"', 'KEY="-----BEGIN', 'abc', '-----END"', 'D=""'].join(
			'\r\n'
		);
		expect(parseDotenv(text)).toEqual([
			{ key: 'A', value: 'hello # not a comment' },
			{ key: 'B', value: 'single $literal' },
			{ key: 'C', value: 'line1\nline2' },
			{ key: 'KEY', value: '-----BEGIN\nabc\n-----END' },
			{ key: 'D', value: '' }
		]);
	});

	test('skips invalid lines and lets the last duplicate win', () => {
		expect(parseDotenv('not a var\n1BAD=x\nA=1\nA=2')).toEqual([{ key: 'A', value: '2' }]);
	});
});
