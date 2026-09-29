import { describe, expect, test } from 'bun:test';
import { applyDrafts, stagedEntries, withDraft, withoutSettled, type Drafts } from '../features/service/staged-drafts';
import { snapshotService, type ServiceSettingsValues } from '../lib/service-settings';
import type { Service } from '../lib/api/types';

const service = {
	id: 'svc-1',
	name: 'web',
	description: '',
	type: 'docker-image',
	config: { image: 'nginx', tag: '1', containerPort: 80, env: [{ key: 'A', value: '1' }], secrets: [], domains: [], volumes: [] },
	autoDeploy: { enabled: false },
	imageWatch: { enabled: false }
} as unknown as Service;

const baseline = snapshotService(service);
const changed = (change: (values: ServiceSettingsValues) => void) => {
	const values = structuredClone(baseline);
	change(values);
	return values;
};

describe('withDraft', () => {
	test('stages an edited service with its baseline', () => {
		const values = changed(v => (v.env[0]!.value = '2'));
		expect(withDraft({}, 'svc-1', baseline, values)).toEqual({ 'svc-1': { baseline, values } });
	});

	test('drops the draft once the edit is reverted', () => {
		const drafts: Drafts = { 'svc-1': { baseline, values: changed(v => (v.tag = '2')) } };
		expect(withDraft(drafts, 'svc-1', baseline, structuredClone(baseline))).toEqual({});
	});
});

describe('applyDrafts', () => {
	const other = { ...service, id: 'svc-2', name: 'api' } as Service;
	const drafts: Drafts = {
		'svc-1': { baseline, values: changed(v => (v.tag = '2')) },
		'svc-2': { baseline, values: changed(v => (v.image = '')) },
		'svc-gone': { baseline, values: changed(v => (v.tag = '3')) }
	};

	test('saves valid drafts, reports invalid ones and settles drafts of deleted services', async () => {
		const saved: string[] = [];
		const outcome = await applyDrafts(drafts, [service, other], 'save', {
			save: async target => void saved.push(target.id),
			deploy: async () => {}
		});
		expect(saved).toEqual(['svc-1']);
		expect(outcome.settled).toEqual(['svc-1', 'svc-gone']);
		expect(Object.keys(outcome.invalid)).toEqual(['svc-2']);
		expect(outcome.failed).toEqual([]);
	});

	test('a save that worked stays settled when its deploy fails', async () => {
		const outcome = await applyDrafts({ 'svc-1': drafts['svc-1']! }, [service], 'deploy', {
			save: async () => {},
			deploy: async () => {
				throw new Error('quota');
			}
		});
		expect(outcome.settled).toEqual(['svc-1']);
		expect(outcome.failed).toMatchObject([{ serviceId: 'svc-1', step: 'deploy' }]);
	});

	test('a failed save keeps the draft', async () => {
		const outcome = await applyDrafts({ 'svc-1': drafts['svc-1']! }, [service], 'deploy', {
			save: async () => {
				throw new Error('conflict');
			},
			deploy: async () => {}
		});
		expect(outcome.settled).toEqual([]);
		expect(outcome.failed).toMatchObject([{ serviceId: 'svc-1', step: 'save' }]);
	});
});

describe('withoutSettled', () => {
	test('drops settled drafts unless they were edited while applying', () => {
		const applied: Drafts = {
			'svc-1': { baseline, values: changed(v => (v.tag = '2')) },
			'svc-2': { baseline, values: changed(v => (v.tag = '4')) }
		};
		const editedMeanwhile = { baseline, values: changed(v => (v.tag = '5')) };
		const current: Drafts = { ...applied, 'svc-2': editedMeanwhile };
		expect(withoutSettled(current, applied, ['svc-1', 'svc-2'])).toEqual({ 'svc-2': editedMeanwhile });
	});
});

describe('stagedEntries', () => {
	test('lists each staged service with the sections it changes', () => {
		const drafts: Drafts = {
			'svc-1': { baseline, values: changed(v => ((v.env[0]!.value = '2'), (v.tag = '2'))) },
			'svc-2': { baseline, values: changed(v => (v.name = 'api')) }
		};
		expect(stagedEntries(drafts)).toEqual([
			{ serviceId: 'svc-1', groups: ['source', 'variables'] },
			{ serviceId: 'svc-2', groups: ['general'] }
		]);
	});
});
