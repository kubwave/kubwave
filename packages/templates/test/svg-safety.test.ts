import { describe, expect, test } from 'bun:test';
import { assertSafeSvg } from '../src/build-catalog';

describe('assertSafeSvg', () => {
	test('passes a clean SVG', () => {
		expect(() => assertSafeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24"/></svg>', 'clean.svg')).not.toThrow();
	});

	test('rejects <script>', () => {
		expect(() => assertSafeSvg('<svg><script>alert(1)</script></svg>', 'bad.svg')).toThrow();
	});

	test('rejects onload=', () => {
		expect(() => assertSafeSvg('<svg onload="alert(1)"></svg>', 'bad.svg')).toThrow();
	});

	test('rejects <foreignObject', () => {
		expect(() => assertSafeSvg('<svg><foreignObject width="100%" height="100%"><div>x</div></foreignObject></svg>', 'bad.svg')).toThrow();
	});
});
