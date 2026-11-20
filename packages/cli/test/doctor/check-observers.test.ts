import { describe, expect, test } from 'vitest';
import { checkObservers } from '../../src/doctor/check-observers.ts';
import type { DeploymentFacts } from '../../src/doctor/deployment-facts.ts';
import type { DeploymentInput } from '../../src/doctor/deployment-input.ts';

const now = Temporal.Instant.from('2026-11-19T10:00:00Z');
const facts = {} as DeploymentFacts;
const reaction = (id: string, on: 'all' | readonly string[], except?: readonly string[]) => ({
  id,
  on,
  ...(except === undefined ? {} : { except }),
});
const inputOf = (...reactions: readonly object[][]): DeploymentInput =>
  ({
    registries: reactions.map((list) => ({
      reactions: new Map(list.map((entry) => [(entry as { id: string }).id, entry])),
    })),
  }) as unknown as DeploymentInput;

describe('the observers check', () => {
  test('gives one note per observer with its except list', async () => {
    const found = await checkObservers(
      inputOf(
        [
          reaction('watch.second', 'all'),
          reaction('audit.recordEvent', 'all', ['audit.entry.erased', 'audit.entry.created']),
          reaction('audit.listed', ['audit.entry.created']),
        ],
        [reaction('audit.recordEvent', 'all', ['audit.entry.erased', 'audit.entry.created'])],
      ),
      facts,
      now,
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
    expect(
      await checkObservers(inputOf([reaction('audit.listed', ['x.y.z'])]), facts, now),
    ).toEqual([]);
    expect(await checkObservers(inputOf(), facts, now)).toEqual([]);
  });
});
