import type { ScopeMark } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { checkEpochBumps } from '../../src/doctor/check-epoch-bumps.ts';
import type { ControlReader } from '../../src/doctor/control-reader.ts';
import { controlReaderOf } from '../../src/doctor/control-reader-of.ts';
import type { DeploymentFacts } from '../../src/doctor/deployment-facts.ts';
import type { DeploymentInput } from '../../src/doctor/deployment-input.ts';

const now = Temporal.Instant.from('2026-11-17T10:00:00Z');
const facts = {} as DeploymentFacts;
const mark = (scopeId: string, epoch: number): ScopeMark => ({
  scopeId,
  namespaceId: 'ns-1',
  position: 5n,
  serials: {},
  epoch,
  updatedAt: now,
});
const inputOf = (reader: Partial<ControlReader> | undefined): DeploymentInput =>
  ({ reader }) as unknown as DeploymentInput;

describe('the epoch bumps check', () => {
  test('gives one note per namespace, in id order, with the scopes and the highest epoch', async () => {
    const found = await checkEpochBumps(
      inputOf({
        bumpedMarks: async () => [
          mark('scope-a', 2),
          mark('scope-b', 2),
          mark('scope-c', 4),
          { ...mark('scope-d', 3), namespaceId: 'ns-0' },
        ],
      }),
      facts,
      now,
    );
    expect(found).toEqual([
      {
        check: 'epoch-bumps',
        severity: 'note',
        subject: 'ns-0',
        message:
          '1 scopes of namespace ns-0 moved to a new epoch after a detected restore (highest epoch 3); tokens issued before each restore answer reset',
        fix: 'nothing to do when the restore was intended; each bump is logged at warn at connect with its scope and reason',
      },
      expect.objectContaining({
        subject: 'ns-1',
        severity: 'note',
        message: expect.stringContaining('3 scopes of namespace ns-1'),
      }),
    ]);
    expect(found[1]?.message).toContain('(highest epoch 4)');
  });

  test('gives nothing without a reader, without a bumped list or without bumps', async () => {
    expect(await checkEpochBumps(inputOf(undefined), facts, now)).toEqual([]);
    expect(await checkEpochBumps(inputOf({}), facts, now)).toEqual([]);
    expect(await checkEpochBumps(inputOf({ bumpedMarks: async () => [] }), facts, now)).toEqual([]);
  });

  test('the reader over the control store lists the marks above epoch 0, so the check finds them', async () => {
    const reader = controlReaderOf(
      {
        read: async (fn: (unit: never) => Promise<unknown>) =>
          fn({ marks: { bumped: async () => [mark('scope-a', 2)] } } as never),
        entity: () => undefined as never,
      } as never,
      () => now,
    );
    const found = await checkEpochBumps(inputOf(reader), facts, now);
    expect(found.map((finding) => finding.subject)).toEqual(['ns-1']);
    const without = controlReaderOf(
      {
        read: async (fn: (unit: never) => Promise<unknown>) => fn({} as never),
        entity: () => undefined as never,
      } as never,
      () => now,
    );
    expect(await without.bumpedMarks?.()).toEqual([]);
  });
});
