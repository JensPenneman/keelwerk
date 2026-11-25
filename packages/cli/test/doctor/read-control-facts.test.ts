import { describe, expect, test } from 'vitest';
import { absent } from '../../src/doctor/absent.ts';
import type { ControlReader } from '../../src/doctor/control-reader.ts';
import { known } from '../../src/doctor/known.ts';
import { readDeploymentFacts } from '../../src/doctor/read-deployment-facts.ts';
import { definitionOf } from '../support/deployment-definition-of.ts';
import { input } from '../support/deployment-input-of.ts';

/** A reader that counts every read and answers with `reachable`. */
function countingReader(reachable: boolean) {
  const reads: string[] = [];
  const reader: ControlReader = {
    reachable: async () => {
      reads.push('reachable');
      return { reachable, detail: reachable ? 'answered' : 'timed out' };
    },
    processes: async () => {
      reads.push('processes');
      return [];
    },
    hookFailures: async () => {
      reads.push('hookFailures');
      return { failures: [], olderUnread: false };
    },
    bumpedMarks: async () => {
      reads.push('bumpedMarks');
      return [];
    },
    heldTenants: async () => {
      reads.push('heldTenants');
      return [];
    },
  };
  return { reads, reader };
}

const readerFacts = [
  'controlReachable',
  'hookFailures',
  'processes',
  'bumpedMarks',
  'heldTenants',
] as const;

describe('the facts read through the control reader', () => {
  test('a store that answers gives all five facts', async () => {
    const { reads, reader } = countingReader(true);
    const facts = await readDeploymentFacts(input(definitionOf(), { reader: known(reader) }));
    expect(readerFacts.map((name) => facts[name].known)).toEqual([true, true, true, true, true]);
    expect(reads.sort()).toEqual(
      [...readerFacts.map((name) => (name === 'controlReachable' ? 'reachable' : name))].sort(),
    );
  });

  test('a store that does not answer: reachability is known as not reachable, the others are absent with its detail, and are not read', async () => {
    const { reads, reader } = countingReader(false);
    const facts = await readDeploymentFacts(input(definitionOf(), { reader: known(reader) }));
    expect(facts.controlReachable).toEqual(known({ reachable: false, detail: 'timed out' }));
    for (const name of ['hookFailures', 'processes', 'bumpedMarks', 'heldTenants'] as const) {
      const fact = facts[name];
      expect(fact.known ? '' : fact.reason).toBe('the control store did not answer: timed out');
    }
    expect(reads).toEqual(['reachable']);
  });

  test('no reader: all five facts are absent with the reason and the fix of the reader', async () => {
    const facts = await readDeploymentFacts(
      input(definitionOf(), { reader: absent('the store is embedded', 'nothing to do') }),
    );
    for (const name of readerFacts) {
      expect(facts[name]).toEqual({
        known: false,
        reason: 'the store is embedded',
        fix: 'nothing to do',
      });
    }
  });
});
