import { describe, expect, test } from 'bun:test';
import { isRecord, readBool, readPath, readRecord, readString, readStringMap } from '../src/lib/object-path.js';

describe('object-path helpers', () => {
	test('isRecord detects plain objects', () => {
		expect(isRecord({})).toBe(true);
		expect(isRecord({ a: 1 })).toBe(true);
		expect(isRecord(null)).toBe(false);
		expect(isRecord(undefined)).toBe(false);
		expect(isRecord([])).toBe(false);
		expect(isRecord('string')).toBe(false);
		expect(isRecord(42)).toBe(false);
	});

	test('readPath navigates nested objects', () => {
		const obj = { a: { b: { c: 'value' } } };
		expect(readPath(obj, ['a', 'b', 'c'])).toBe('value');
		expect(readPath(obj, ['a', 'b'])).toEqual({ c: 'value' });
	});

	test('readPath returns undefined for missing paths', () => {
		const obj = { a: 1 };
		expect(readPath(obj, ['b'])).toBeUndefined();
		expect(readPath(obj, ['a', 'b'])).toBeUndefined();
		expect(readPath(null, ['a'])).toBeUndefined();
		expect(readPath(undefined, ['a'])).toBeUndefined();
	});

	test('readString extracts string values', () => {
		expect(readString({ key: 'hello' }, ['key'])).toBe('hello');
		expect(readString({ key: '' }, ['key'])).toBeUndefined();
		expect(readString({ key: 42 }, ['key'])).toBeUndefined();
		expect(readString({}, ['key'])).toBeUndefined();
		expect(readString(undefined, ['key'])).toBeUndefined();
	});

	test('readBool extracts boolean values', () => {
		expect(readBool({ key: true }, ['key'])).toBe(true);
		expect(readBool({ key: false }, ['key'])).toBe(false);
		expect(readBool({ key: 'true' }, ['key'])).toBeUndefined();
		expect(readBool({}, ['key'])).toBeUndefined();
		expect(readBool(undefined, ['key'])).toBeUndefined();
	});

	test('readRecord extracts nested objects', () => {
		expect(readRecord({ key: { a: 1 } }, ['key'])).toEqual({ a: 1 });
		expect(readRecord({ key: 'not-obj' }, ['key'])).toBeUndefined();
		expect(readRecord({ key: null }, ['key'])).toBeUndefined();
		expect(readRecord({ key: [] }, ['key'])).toBeUndefined();
		expect(readRecord({}, ['key'])).toBeUndefined();
		expect(readRecord(undefined, ['key'])).toBeUndefined();
	});

	test('readStringMap extracts string-only records', () => {
		expect(readStringMap({ key: { a: '1', b: '2' } }, ['key'])).toEqual({ a: '1', b: '2' });
	});

	test('readStringMap filters out non-string and empty values', () => {
		expect(readStringMap({ key: { a: 'ok', b: '', c: 42 } }, ['key'])).toEqual({ a: 'ok' });
		expect(readStringMap({ key: { a: '' } }, ['key'])).toBeUndefined();
	});

	test('readStringMap returns undefined for non-records', () => {
		expect(readStringMap({ key: 'not-obj' }, ['key'])).toBeUndefined();
		expect(readStringMap({}, ['key'])).toBeUndefined();
		expect(readStringMap(undefined, ['key'])).toBeUndefined();
	});
});
