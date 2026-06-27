import { describe, expect, test } from 'bun:test';
import { parseChannel, resolveChannel } from '../src/lib/channel.js';

describe('channel helpers', () => {
	test('parses supported channels', () => {
		expect(parseChannel('stable', '--channel')).toBe('stable');
		expect(parseChannel('preview', '--channel')).toBe('preview');
	});

	test('rejects unsupported channels', () => {
		expect(() => parseChannel('edge', '--channel')).toThrow("--channel must be 'stable' or 'preview'");
	});

	test('rejects undefined channels', () => {
		expect(() => parseChannel(undefined, '--channel')).toThrow('--channel is not set');
	});

	test('resolves override before marker and env defaults', () => {
		process.env['KUBWAVE_CHANNEL'] = 'preview';
		try {
			expect(resolveChannel({ override: 'stable', markerChannel: 'preview' })).toBe('stable');
			expect(resolveChannel({ markerChannel: 'stable' })).toBe('preview');
		} finally {
			delete process.env['KUBWAVE_CHANNEL'];
		}
	});

	test('resolves markerChannel when env is not set', () => {
		const prev = process.env['KUBWAVE_CHANNEL'];
		delete process.env['KUBWAVE_CHANNEL'];
		try {
			expect(resolveChannel({ markerChannel: 'preview' })).toBe('preview');
		} finally {
			if (prev === undefined) delete process.env['KUBWAVE_CHANNEL'];
			else process.env['KUBWAVE_CHANNEL'] = prev;
		}
	});

	test('defaults to stable when nothing is set', () => {
		delete process.env['KUBWAVE_CHANNEL'];
		expect(resolveChannel({})).toBe('stable');
	});

	test('falls through empty env string to markerChannel', () => {
		process.env['KUBWAVE_CHANNEL'] = '';
		try {
			expect(resolveChannel({ markerChannel: 'preview' })).toBe('preview');
		} finally {
			delete process.env['KUBWAVE_CHANNEL'];
		}
	});

	test('falls through empty env string to default stable', () => {
		process.env['KUBWAVE_CHANNEL'] = '';
		try {
			expect(resolveChannel({})).toBe('stable');
		} finally {
			delete process.env['KUBWAVE_CHANNEL'];
		}
	});
});
