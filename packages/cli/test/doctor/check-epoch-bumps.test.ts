import type { ScopeMark } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { absent } from '../../src/doctor/absent.ts';
import { epochBumpsCheck } from '../../src/doctor/check-epoch-bumps.ts';
import { controlReaderOf } from '../../src/doctor/control-reader-of.ts';
import { known } from '../../src/doctor/known.ts';
import { runDeploymentChecks } from '../../src/doctor/run-deployment-checks.ts';
import { factsOf } from '../support/facts-of.ts';

const now = Temporal.Instant.from('2026-11-17T10:00:00Z');
const mark = (scopeId: string, epoch: number): ScopeMark => ({
  scopeId,
  namespaceId: 'ns-1',
  position: 5n,
  serials: {},
  epoch,
  updatedAt: now,
});
const check = (marks: readonly ScopeMark[]) =>
  runDeploymentChecks([epochBumpsCheck], factsOf({ bumpedMarks: known(marks) }));

describe('the epoch bumps check', () => {
  test('gives one note per namespace, in id order, with the scopes and the highest epoch', async () => {
    const found = check([
      mark('scope-a', 2),
      mark('scope-b', 2),
      mark('scope-c', 4),
      { ...mark('scope-d', 3), namespaceId: 'ns-0' },
    ]);
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

  test('gives nothing without a bump, and says so when the marks could not be read', () => {
    expect(check([])).toEqual([]);
    const unread = runDeploymentChecks(
      [epochBumpsCheck],
      factsOf({ bumpedMarks: absent('the control store could not be read: down', 'start it') }),
    );
    expect(unread.map((finding) => [finding.severity, finding.message])).toEqual([
      ['not-checked', 'the control store could not be read: down'],
    ]);
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
    const found = check(await reader.bumpedMarks());
    expect(found.map((finding) => finding.subject)).toEqual(['ns-1']);
    const without = controlReaderOf(
      {
        read: async (fn: (unit: never) => Promise<unknown>) => fn({} as never),
        entity: () => undefined as never,
      } as never,
      () => now,
    );
    expect(await without.bumpedMarks()).toEqual([]);
  });
});
