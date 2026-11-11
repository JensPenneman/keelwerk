import { describe, expect, test } from 'vitest';
import { sha256 } from '../crypto/sha256.ts';
import type { StreamRef } from '../events/stream-ref.ts';
import { field } from '../fields/field.ts';
import type { ShapeFields } from '../fields/shape.ts';
import { shape } from '../fields/shape.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import { kweAad } from '../keys/kwe-aad.ts';
import { secretRefOwner } from '../keys/secret-ref-owner.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { openEffectInput } from './open-effect-input.ts';
import { sealEffectInput } from './seal-effect-input.ts';
import { sealEffectOutput } from './seal-effect-output.ts';
import { settledEffectDraft } from './settled-effect-draft.ts';

const effectId = '0198a1e0-0000-8000-8000-0000000000e1';
const owner = '0198a1e0-0000-7000-8000-0000000000a1';
const valueKeyId = '0198a1e0-0000-7000-8000-00000000c001';
const fixed = (bytes: number): Uint8Array => new Uint8Array(bytes).fill(9);
const registry = { entities: new Map() } as unknown as Registry;

interface Stub {
  readonly unit: Unit;
  readonly refs: { readonly subject: string; readonly streams: readonly StreamRef[] }[];
  readonly bindings: { readonly entity: string; readonly id: string; readonly field: string }[];
  shred(): void;
}

function stubUnit(options: { readonly erased?: boolean } = {}): Stub {
  const key = { id: 'key-1', material: new Uint8Array(32).fill(7) };
  let shredded = false;
  const refs: Stub['refs'][number][] = [];
  const bindings: Stub['bindings'][number][] = [];
  const unit = {
    namespace: { id: 'main' },
    keys: {
      dataKey: () => Promise.resolve(options.erased === true || shredded ? undefined : key),
      keyById: (id: string) => Promise.resolve(shredded || id !== key.id ? undefined : key),
      addRefs: (subject: string, streams: readonly StreamRef[]) => {
        refs.push({ subject, streams });
        return Promise.resolve();
      },
      sealValue: (binding: Stub['bindings'][number]) => {
        bindings.push(binding);
        return Promise.resolve({
          keyId: valueKeyId,
          nonce: fixed(12),
          ciphertext: new Uint8Array(16),
        });
      },
    },
  } as unknown as Unit;
  return {
    unit,
    refs,
    bindings,
    shred: () => {
      shredded = true;
    },
  };
}

function effect(
  input: ShapeFields,
  extra: { readonly dataSubject?: string; readonly output?: ShapeFields } = {},
): EffectEntry {
  return {
    ref: 'courier.deliver',
    module: 'courier',
    name: 'deliver',
    performer: 'executor',
    executor: 'courier.deliver',
    input: shape(input),
    output: shape(extra.output ?? {}),
    ...(extra.dataSubject === undefined ? {} : { dataSubject: extra.dataSubject }),
  };
}

const deliver = effect(
  {
    owner: field.subject(),
    to: field.string().personal(),
    cc: field.list(field.string()).personal(),
    signingKey: field.secret(),
  },
  { dataSubject: 'owner' },
);

describe('sealed effect input', () => {
  test('a personal input member is the $kwe envelope of golden vector G1', async () => {
    const stub = stubUnit();
    const sealed = (await sealEffectInput({
      unit: stub.unit,
      registry,
      entry: deliver,
      effectId,
      input: { owner, to: 'ada@example.org', cc: ['bob@example.org', 'eve@example.org'] },
      random: fixed,
    })) as Record<string, unknown>;
    expect(sealed.to).toEqual({
      $kwe: 1,
      k: 'key-1',
      n: 'CQkJCQkJCQkJCQkJ',
      c: 'BeTg9f6VuQDNEqddyIXRuPbRoonqvAopbeX2gnb9Stt-',
    });
    expect(sealed.cc).toEqual({
      $kwe: 1,
      k: 'key-1',
      n: 'CQkJCQkJCQkJCQkJ',
      c: 'fKfm-9ywpBnBD7tUg8TMrbOST9FRmJKACtYny6UYZFS8l4Dhvw2FB9e1LZpf7ywyqVKSkgU',
    });
    expect(sealed.owner).toBe(owner);
    expect(
      Buffer.from(
        kweAad({ namespace: 'main', streamId: effectId, eventId: effectId, field: 'input.to' }),
      ).toString('hex'),
    ).toBe(
      '000000046d61696e0000002430313938613165302d303030302d383030302d383030302d3030303030303030303065310000002430313938613165302d303030302d383030302d383030302d30303030303030303030653100000008696e7075742e746f',
    );
    expect(stub.refs).toEqual([
      { subject: owner, streams: [{ type: 'core.effect', id: effectId }] },
    ]);
  });

  test('a secret member is sealed under its own value key and stored as text', async () => {
    const stub = stubUnit();
    const sealed = (await sealEffectInput({
      unit: stub.unit,
      registry,
      entry: deliver,
      effectId,
      input: { owner, signingKey: 'plain-signing-key-1' },
      random: fixed,
    })) as Record<string, unknown>;
    expect(sealed.signingKey).toBe(`kwv1.${valueKeyId}.CQkJCQkJCQkJCQkJ.AAAAAAAAAAAAAAAAAAAAAA`);
    expect(stub.bindings).toEqual([{ entity: 'core.effect', id: effectId, field: 'signingKey' }]);
  });

  test('openEffectInput answers the plaintext and secrets as references of the effect module', async () => {
    const stub = stubUnit();
    const sealed = (await sealEffectInput({
      unit: stub.unit,
      registry,
      entry: deliver,
      effectId,
      input: { owner, to: 'ada@example.org', cc: ['bob@example.org'], signingKey: 'k-1' },
    })) as Record<string, unknown>;
    const { input, erased } = await openEffectInput(stub.unit, deliver, effectId, sealed);
    expect(erased).toEqual([]);
    expect(input.to).toBe('ada@example.org');
    expect(input.cc).toEqual(['bob@example.org']);
    expect(input.owner).toBe(owner);
    const ref = input.signingKey as { readonly ref: string };
    expect(ref.ref).toBe(sealed.signingKey);
    expect(Reflect.get(ref, secretRefOwner)).toBe('courier');
    expect(Object.keys(ref)).toEqual(['ref']);
  });

  test('a shredded key or another effect id leaves the member out and names it in erased', async () => {
    const stub = stubUnit();
    const sealed = (await sealEffectInput({
      unit: stub.unit,
      registry,
      entry: deliver,
      effectId,
      input: { owner, to: 'ada@example.org' },
    })) as Record<string, unknown>;
    const moved = await openEffectInput(stub.unit, deliver, 'another-effect', sealed);
    expect(moved.erased).toEqual(['to']);
    expect(moved.input).not.toHaveProperty('to');
    stub.shred();
    const gone = await openEffectInput(stub.unit, deliver, effectId, sealed);
    expect(gone.erased).toEqual(['to']);
    expect(gone.input.owner).toBe(owner);
  });

  test('a non-personal member that holds an envelope-shaped value passes through unopened', async () => {
    const entry = effect(
      {
        owner: field.subject(),
        meta: field.json(
          shape({ $kwe: field.integer(), k: field.string(), n: field.string(), c: field.string() }),
        ),
      },
      { dataSubject: 'owner' },
    );
    const meta = { $kwe: 1, k: 'key-1', n: 'AAAA', c: 'AAAA' };
    const { input, erased } = await openEffectInput(stubUnit().unit, entry, effectId, {
      owner,
      meta,
    });
    expect(erased).toEqual([]);
    expect(input.meta).toEqual(meta);
  });

  test('a personal member without a subject path is refused with core.request_not_allowed', async () => {
    const entry = effect({ to: field.string().personal() });
    await expect(
      sealEffectInput({ unit: stubUnit().unit, registry, entry, effectId, input: { to: 'a@b.c' } }),
    ).rejects.toMatchObject({ code: 'core.request_not_allowed' });
  });

  test('an unresolvable subject is validation with the member path', async () => {
    await expect(
      sealEffectInput({
        unit: stubUnit().unit,
        registry,
        entry: deliver,
        effectId,
        input: { to: 'ada@example.org' },
      }),
    ).rejects.toMatchObject({
      kind: 'validation',
      message: 'courier.deliver.to is personal and needs its data subject "owner".',
      issues: [{ path: ['to'] }],
    });
  });

  test('an erased subject is forbidden', async () => {
    await expect(
      sealEffectInput({
        unit: stubUnit({ erased: true }).unit,
        registry,
        entry: deliver,
        effectId,
        input: { owner, to: 'ada@example.org' },
      }),
    ).rejects.toMatchObject({
      kind: 'forbidden',
      message: 'The data subject was erased: personal values cannot be written.',
    });
  });

  test('an absent personal member needs no subject', async () => {
    const stub = stubUnit();
    const sealed = await sealEffectInput({
      unit: stub.unit,
      registry,
      entry: deliver,
      effectId,
      input: { signingKey: undefined },
    });
    expect(sealed).toEqual({ signingKey: undefined });
    expect(stub.refs).toEqual([]);
  });
});

describe('sealed effect output', () => {
  test('sealEffectOutput seals secret members under output.<name> and the digest covers the sealed form', async () => {
    const stub = stubUnit();
    const entry = effect({}, { output: { status: field.integer(), token: field.secret() } });
    const sealed = await sealEffectOutput(stub.unit, entry, effectId, {
      status: 200,
      token: 'plain-token-1',
    });
    expect(sealed).toEqual({
      status: 200,
      token: `kwv1.${valueKeyId}.CQkJCQkJCQkJCQkJ.AAAAAAAAAAAAAAAAAAAAAA`,
    });
    expect(stub.bindings).toEqual([{ entity: 'core.effect', id: effectId, field: 'output.token' }]);
    expect(JSON.stringify(sealed)).not.toContain('plain-token-1');
    const draft = settledEffectDraft('e-1', Temporal.Instant.from('2026-11-11T00:00:00Z'), {
      ok: true,
      value: { status: 200, token: `kwv1.${valueKeyId}.CQkJCQkJCQkJCQkJ.AAAAAAAAAAAAAAAAAAAAAA` },
    });
    expect(draft.values.outputDigest).toBe(
      'cb896f0d4746c35eaba68a678b6c15d805120049712fdd4210656c050af63ba4',
    );
    const own = settledEffectDraft('e-1', Temporal.Instant.from('2026-11-11T00:00:00Z'), {
      ok: true,
      value: sealed as Record<string, unknown>,
    });
    expect(own.values.outputDigest).toBe(sha256(canonicalizeJson(sealed)));
    expect(own.values.outputDigest).toBe(draft.values.outputDigest);
  });

  test('an output with a personal field is internal', async () => {
    const entry = effect({}, { output: { mail: field.string().personal() } });
    await expect(
      sealEffectOutput(stubUnit().unit, entry, effectId, { mail: 'a@b.c' }),
    ).rejects.toMatchObject({
      kind: 'internal',
    });
  });
});
