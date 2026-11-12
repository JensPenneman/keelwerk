import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { Registry } from '../registry/registry.ts';
import type { PurgedJob } from '../storage/purged-job.ts';
import type { SealedValue } from '../storage/sealed-value.ts';
import type { Unit } from '../storage/unit.ts';
import { jobValueKeys } from './job-value-keys.ts';

const commandId = '0198a1e0-0000-7000-8000-0000000000c1';
const text = (keyId: string): string => `kwv1.${keyId}.bm9uY2U.Y2lwaGVy`;

const registry = {
  actions: new Map([
    [
      'm.change',
      {
        input: shape({
          note: field.string(),
          password: field.secret(),
          tokens: field.list(field.secret()),
          carried: field.secret(),
        }),
      },
    ],
  ]),
} as unknown as Registry;

/** A unit whose keys open only for the binding they were sealed under: `core.job`, the command id and the member. */
function unitOf(bindings: Readonly<Record<string, string>>): Unit {
  return {
    keys: {
      openValue: (
        sealed: SealedValue,
        expected?: { entity: string; id: string; field: string },
      ) => {
        const bound = bindings[sealed.keyId];
        const here = `${expected?.entity}/${expected?.id}/${expected?.field}`;
        return Promise.resolve(bound === here ? new Uint8Array(1) : undefined);
      },
    },
  } as unknown as Unit;
}

const job = (input: unknown, id: string | null = commandId): PurgedJob => ({
  queue: 'commands',
  run: { action: 'm.change', input, ...(id === null ? {} : { commandId: id }) },
});

describe('the value keys of the secret members of purged jobs (S4)', () => {
  test('names the key of each secret text, and of each element of a list of them', async () => {
    const unit = unitOf({
      k1: `core.job/${commandId}/password`,
      k2: `core.job/${commandId}/tokens`,
      k3: `core.job/${commandId}/tokens`,
    });
    const keys = await jobValueKeys(unit, registry, [
      job({ note: text('k9'), password: text('k1'), tokens: [text('k2'), text('k3')] }),
    ]);
    expect(keys.toSorted()).toEqual(['k1', 'k2', 'k3']);
  });

  test('a `{ ref }` member, a text sealed for another binding, a destroyed key and a plain member name nothing', async () => {
    const unit = unitOf({
      k1: 'core.commandReceipt/other/password',
      k2: `core.job/${commandId}/password`,
    });
    const keys = await jobValueKeys(unit, registry, [
      job({ password: text('k1'), carried: { ref: text('k2') }, note: text('k2') }),
      job({ password: text('gone') }),
    ]);
    expect(keys).toEqual([]);
  });

  test('a job without a command id, of an unknown action or of an effect names nothing', async () => {
    const unit = unitOf({ k1: `core.job/${commandId}/password` });
    const stranger: PurgedJob = {
      queue: 'commands',
      run: { action: 'm.gone', input: {}, commandId },
    };
    const effect: PurgedJob = { queue: 'effects', run: { executor: 'x', effect: 'e' } };
    expect(
      await jobValueKeys(unit, registry, [job({ password: text('k1') }, null), stranger, effect]),
    ).toEqual([]);
  });
});
