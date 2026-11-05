import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { AnyDraft } from '../protocol/any-draft.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { sealDrafts } from './seal-drafts.ts';

const own = 'kwv1.k-own.AAAA.BBBB';
const foreign = 'kwv1.k-foreign.AAAA.BBBB';

const credential = { kind: 'secret', inner: null };
const registry = {
  entities: new Map([
    [
      'vault.credential',
      {
        ref: 'vault.credential',
        descriptor: {
          fields: {
            apiKey: credential,
            hash: { kind: 'verifier', inner: null },
            keys: { kind: 'list', inner: credential },
          },
        },
        events: { leaked: shape({ token: field.secret() }), fine: shape({ note: field.string() }) },
      },
    ],
  ]),
} as unknown as Registry;

function setup() {
  const destroyed: string[] = [];
  const sealed: string[] = [];
  const unit = {
    keys: {
      sealValue: async () => {
        sealed.push('new');
        return { keyId: 'k-new', nonce: new Uint8Array(12), ciphertext: new Uint8Array(20) };
      },
      destroyValueKey: async (keyId: string) => {
        destroyed.push(keyId);
      },
    },
    rows: { find: async () => ({ rows: [{ apiKey: own, hash: own }] }) },
  } as unknown as Unit;
  return { unit, destroyed, sealed };
}

const draft = (kind: 'create' | 'update', values: Record<string, unknown>): AnyDraft =>
  ({
    kind,
    target: 'vault.credential',
    type: kind,
    entity: 'vault.credential',
    id: 'c1',
    values,
  }) as unknown as AnyDraft;

const run = (unit: Unit, drafts: AnyDraft[]) => sealDrafts({ registry, unit, drafts });

describe('sealDrafts references and unsealed credentials', () => {
  test("keeps the row's own current reference and destroys nothing", async () => {
    const { unit, destroyed } = setup();
    const [out] = await run(unit, [draft('update', { apiKey: { ref: own }, hash: own })]);
    expect(out).toMatchObject({ values: { apiKey: own, hash: own } });
    expect(destroyed).toEqual([]);
  });

  test('refuses a reference from another row, on update and on create', async () => {
    const { unit, destroyed } = setup();
    await expect(run(unit, [draft('update', { apiKey: { ref: foreign } })])).rejects.toMatchObject({
      kind: 'validation',
    });
    await expect(run(unit, [draft('create', { apiKey: { ref: own } })])).rejects.toMatchObject({
      kind: 'validation',
    });
    await expect(run(unit, [draft('update', { hash: foreign })])).rejects.toMatchObject({
      kind: 'validation',
    });
    expect(destroyed).toEqual([]);
  });

  test('seals a new plain value and destroys the former key', async () => {
    const { unit, destroyed } = setup();
    const [out] = await run(unit, [draft('update', { apiKey: 'plain' })]);
    expect(out).toMatchObject({ values: { apiKey: expect.stringMatching(/^kwv1\.k-new\./) } });
    expect(destroyed).toEqual(['k-own']);
  });

  test('refuses a list of secrets and a secret in an event payload instead of storing them in plaintext', async () => {
    const { unit, sealed } = setup();
    await expect(run(unit, [draft('create', { keys: ['a'] })])).rejects.toMatchObject({
      kind: 'validation',
    });
    const event = (type: string): AnyDraft =>
      ({
        kind: 'event',
        target: 'vault.credential',
        type,
        entity: 'vault.credential',
        id: 'c1',
        values: {},
      }) as unknown as AnyDraft;
    await expect(run(unit, [event('leaked')])).rejects.toMatchObject({ kind: 'validation' });
    await expect(run(unit, [event('fine')])).resolves.toHaveLength(1);
    expect(sealed).toEqual([]);
  });
});
