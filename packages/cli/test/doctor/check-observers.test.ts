import type { Registry } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { observersCheck } from '../../src/doctor/check-observers.ts';
import { known } from '../../src/doctor/known.ts';
import { runDeploymentChecks } from '../../src/doctor/run-deployment-checks.ts';
import { factsOf } from '../support/facts-of.ts';

const reaction = (id: string, on: 'all' | readonly string[], except?: readonly string[]) => ({
  id,
  on,
  ...(except === undefined ? {} : { except }),
});
const check = (...reactions: readonly object[][]) =>
  runDeploymentChecks(
    [observersCheck],
    factsOf({
      registries: known(
        reactions.map(
          (list) =>
            ({
              reactions: new Map(list.map((entry) => [(entry as { id: string }).id, entry])),
            }) as unknown as Registry,
        ),
      ),
    }),
  );

describe('the observers check', () => {
  test('gives one note per observer with its except list', async () => {
    const found = check(
      [
        reaction('watch.second', 'all'),
        reaction('audit.recordEvent', 'all', ['audit.entry.erased', 'audit.entry.created']),
        reaction('audit.listed', ['audit.entry.created']),
      ],
      [reaction('audit.recordEvent', 'all', ['audit.entry.erased', 'audit.entry.created'])],
    );
    expect(found.map((finding) => [finding.check, finding.severity, finding.subject])).toEqual([
      ['observers', 'note', 'audit.recordEvent'],
      ['observers', 'note', 'watch.second'],
    ]);
    expect(found[0]?.message).toBe(
      "observes every event of a tenant or a backend: one job per event and scope, and receives the address and user agent of a data subject's requests; excepted: audit.entry.created, audit.entry.erased",
    );
    expect(found[1]?.message).toContain('excepted: none');
  });

  test('gives nothing without an observer', async () => {
    expect(check([reaction('audit.listed', ['x.y.z'])])).toEqual([]);
    expect(check()).toEqual([]);
  });
});
