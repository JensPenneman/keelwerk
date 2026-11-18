import { createCipheriv, createDecipheriv } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { SealedValue } from '../storage/sealed-value.ts';
import type { Unit } from '../storage/unit.ts';
import { openSecretMembers } from '../write-path/open-secret-members.ts';
import { sealJobInput } from './seal-job-input.ts';

const commandId = '0198a1e0-0000-7000-8000-0000000000c1';
const valueKeyId = '0198a1e0-0000-7000-8000-00000000c001';
const scopeKey = new Uint8Array(32).fill(7);
const nonce = new Uint8Array(12).fill(9);
const aadOf = (binding: { entity: string; id: string; field: string }): Buffer =>
  Buffer.from([binding.entity, binding.id, binding.field].join('\u0000'));

/** A unit whose value key is fixed: AES-256-GCM under the scope key, a fixed nonce, the binding as associated data. */
const unit = {
  keys: {
    sealValue: (binding: { entity: string; id: string; field: string }, plain: Uint8Array) => {
      const cipher = createCipheriv('aes-256-gcm', scopeKey, nonce);
      cipher.setAAD(aadOf(binding));
      const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
      return Promise.resolve({ keyId: valueKeyId, nonce, ciphertext: new Uint8Array(body) });
    },
    openValue: (
      sealed: SealedValue,
      expected: { entity: string; id: string; field: string },
    ): Promise<Uint8Array | undefined> => {
      const body = Buffer.from(sealed.ciphertext);
      const decipher = createDecipheriv('aes-256-gcm', scopeKey, sealed.nonce);
      decipher.setAAD(aadOf(expected));
      decipher.setAuthTag(body.subarray(body.length - 16));
      try {
        const plain = Buffer.concat([
          decipher.update(body.subarray(0, body.length - 16)),
          decipher.final(),
        ]);
        return Promise.resolve(new Uint8Array(plain));
      } catch {
        return Promise.resolve(undefined);
      }
    },
  },
} as unknown as Unit;

const action = {
  input: shape({ to: field.string(), token: field.secret() }),
} as unknown as ActionEntry;

const opening = (id: string) => ({
  entity: 'core.job',
  id,
  prefix: '',
  lost: 'The stored input of this job can no longer be read.',
});

describe('the sealed input of a job (golden, final)', () => {
  test('a fixed scope key, command id, member and nonce give this exact stored input', async () => {
    const stored = await sealJobInput(unit, {} as Registry, commandId, action, {
      to: 'ada@example.org',
      token: 'hunter2',
    });
    expect(stored).toEqual({
      to: 'ada@example.org',
      token:
        'kwv1.0198a1e0-0000-7000-8000-00000000c001.CQkJCQkJCQkJCQkJ.T_Dq4NuC8-QhkVLnBs3k_ucG3gdDBiQ',
    });
  });

  test('the same binding opens it, another command id does not', async () => {
    const stored = await sealJobInput(unit, {} as Registry, commandId, action, {
      to: 'ada@example.org',
      token: 'hunter2',
    });
    expect(await openSecretMembers(unit, opening(commandId), action.input, stored)).toEqual({
      to: 'ada@example.org',
      token: 'hunter2',
    });
    await expect(
      openSecretMembers(
        unit,
        opening('0198a1e0-0000-7000-8000-0000000000c2'),
        action.input,
        stored,
      ),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });
});

describe('a job whose generated write would store a credential or personal value unsealed', () => {
  const personal = { kind: 'string', personal: { subject: 'id' }, sealed: false, inner: null };
  const registry = {
    entities: new Map([
      [
        'probe.person',
        {
          descriptor: {
            fields: {
              name: { kind: 'string', personal: false, sealed: false, inner: null },
              email: personal,
              password: { kind: 'secret', personal: false, sealed: true, inner: null },
              apiKey: { kind: 'verifier', personal: false, sealed: true, inner: null },
            },
          },
        },
      ],
    ]),
  } as unknown as Registry;
  const generatedOf = (generated: 'create' | 'update' | 'set') =>
    ({
      ref: `probe.person.${generated}`,
      module: 'probe',
      entity: 'probe.person',
      generated,
      input: shape({}),
    }) as unknown as ActionEntry;
  const seal = vi.fn(unit.keys.sealValue.bind(unit.keys));
  const spied = { keys: { ...unit.keys, sealValue: seal } } as unknown as Unit;

  async function refusal(generated: 'create' | 'update' | 'set', input: object) {
    seal.mockClear();
    const error = await sealJobInput(
      spied,
      registry,
      commandId,
      generatedOf(generated),
      input,
    ).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(seal).not.toHaveBeenCalled();
    return error;
  }

  test('an enqueue of a generated update whose patch names a secret is refused', async () => {
    const error = await refusal('update', { id: 'p1', patch: { password: 'hunter2' } });
    expect(error).toMatchObject({ kind: 'internal', code: 'core.request_not_allowed' });
    expect(String((error as Error).message)).toContain('probe.person.update');
    expect(String((error as Error).message)).toContain("'patch.password'");
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain('hunter2');
  });

  test('an enqueue of a generated set whose item names a personal field is refused', async () => {
    const error = await refusal('set', {
      create: [{ name: 'Ada' }],
      update: [{ id: 'p1', patch: { email: 'ada@example.org' } }],
    });
    expect(error).toMatchObject({ kind: 'internal', code: 'core.request_not_allowed' });
    expect(String((error as Error).message)).toContain("'update.0.patch.email'");
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain('ada@example');
  });

  test('an item of a map is named by a star: its key is an input value and stays out of the error', async () => {
    const key = 'ada@example.org';
    for (const [input, member] of [
      [{ create: { [key]: { name: 'x', email: 'someone@example.org' } } }, 'create.*.email'],
      [
        { update: { [key]: { id: 'p1', patch: { password: 'hunter2' } } } },
        'update.*.patch.password',
      ],
    ] as const) {
      const error = await refusal('set', input);
      expect(error).toMatchObject({ kind: 'internal', code: 'core.request_not_allowed' });
      expect(String((error as Error).message)).toContain(`'${member}'`);
      const shown = JSON.stringify(error, Object.getOwnPropertyNames(error));
      expect(shown).not.toContain(key);
      expect(shown).not.toContain('example.org');
    }
  });

  test('an enqueue of a generated create with a verifier is refused', async () => {
    const error = await refusal('create', { name: 'Ada', apiKey: 'k-123' });
    expect(error).toMatchObject({ kind: 'internal', code: 'core.request_not_allowed' });
    expect(String((error as Error).message)).toContain("'apiKey'");
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain('k-123');
  });

  test('a generated write without such a member is sealed as any other, and an unknown entity is not refused', async () => {
    await expect(
      sealJobInput(spied, registry, commandId, generatedOf('update'), {
        id: 'p1',
        patch: { name: 'Ada' },
      }),
    ).resolves.toBeDefined();
    const unknown = { ...generatedOf('update'), entity: 'probe.other' } as ActionEntry;
    await expect(
      sealJobInput(spied, registry, commandId, unknown, { id: 'p1', patch: { password: 'x' } }),
    ).resolves.toBeDefined();
  });
});
