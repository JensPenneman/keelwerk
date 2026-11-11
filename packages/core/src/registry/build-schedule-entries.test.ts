import { describe, expect, test } from 'vitest';
import type { ActionEntry } from './action-entry.ts';
import { buildScheduleEntries } from './build-schedule-entries.ts';
import type { RuntimeModule } from './runtime-module.ts';

const action = (ref: string, module: string, scope: ActionEntry['scope']): ActionEntry =>
  ({ ref, module, scope, kind: 'command' }) as unknown as ActionEntry;

const actions = new Map<string, ActionEntry>([
  ['ticker.recordTick', action('ticker.recordTick', 'ticker', 'tenant')],
  ['ticker.recordBeat', action('ticker.recordBeat', 'ticker', 'backend')],
  ['ticker.sweep', action('ticker.sweep', 'ticker', 'invocation')],
  ['ticker.closeAll', action('ticker.closeAll', 'ticker', 'deployment')],
  ['other.recordTick', action('other.recordTick', 'other', 'tenant')],
]);

function modulesWith(spec: Record<string, unknown>): readonly RuntimeModule[] {
  return [{ id: 'ticker', schedules: { run: { spec } } } as unknown as RuntimeModule];
}

const codes = (spec: Record<string, unknown>): string[] =>
  buildScheduleEntries(modulesWith(spec), actions).problems.map((problem) => problem.code);

describe('the schedules of the modules at compose', () => {
  test("another module's command is unknownScheduleActions", () => {
    expect(codes({ every: '5m', invoke: 'other.recordTick', scope: 'each-tenant' })).toEqual([
      'unknownScheduleActions',
    ]);
  });

  test('a backend schedule of a tenant action is mismatchedScheduleScopes', () => {
    expect(codes({ every: '5m', invoke: 'ticker.recordTick', scope: 'backend' })).toEqual([
      'mismatchedScheduleScopes',
    ]);
    expect(codes({ every: '5m', invoke: 'ticker.recordBeat', scope: 'backend' })).toEqual([]);
    expect(codes({ every: '5m', invoke: 'ticker.recordTick', scope: 'each-tenant' })).toEqual([]);
    expect(codes({ every: '5m', invoke: 'ticker.sweep', scope: 'each-tenant' })).toEqual([]);
  });

  test('an each-tenant schedule of a backend command is mismatchedScheduleScopes', () => {
    expect(codes({ every: '5m', invoke: 'ticker.recordBeat', scope: 'each-tenant' })).toEqual([
      'mismatchedScheduleScopes',
    ]);
  });

  test('a deployment action is mismatchedScheduleScopes for either scope', () => {
    expect(codes({ every: '5m', invoke: 'ticker.closeAll', scope: 'backend' })).toEqual([
      'mismatchedScheduleScopes',
    ]);
    expect(codes({ every: '5m', invoke: 'ticker.closeAll', scope: 'each-tenant' })).toEqual([
      'mismatchedScheduleScopes',
    ]);
  });

  test('an unparsable every or jitter, or a jitter not below every, is invalidScheduleDurations', () => {
    const base = { invoke: 'ticker.recordBeat', scope: 'backend' };
    expect(codes({ ...base, every: 'often' })).toEqual(['invalidScheduleDurations']);
    expect(codes({ ...base, every: '0s' })).toEqual(['invalidScheduleDurations']);
    expect(codes({ ...base, every: '5m', jitter: 'some' })).toEqual(['invalidScheduleDurations']);
    expect(codes({ ...base, every: '5m', jitter: '5m' })).toEqual(['invalidScheduleDurations']);
    expect(codes({ ...base, every: '5m', jitter: '30s' })).toEqual([]);
  });

  test('an unmounted part stays unresolvedPartReferences', () => {
    expect(codes({ every: '5m', invoke: {}, scope: 'backend' })).toEqual([
      'unresolvedPartReferences',
    ]);
  });
});
