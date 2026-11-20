import type { DataKey } from '../src/storage/data-key.ts';
import type { Scope } from '../src/storage/scope.ts';
import type { SealedValue } from '../src/storage/sealed-value.ts';
import type { Unit } from '../src/storage/unit.ts';

interface Binding {
  readonly entity: string;
  readonly id: string;
  readonly field: string;
}

/** A unit whose key store keeps subject keys and value keys in memory: just enough for the records a decision seals. */
interface KeysUnit {
  readonly unit: Unit;
  /** Destroys every key version of the subject, as `shred` does. */
  shred(subjectId: string): void;
  /** Every value key sealed so far, by key id, with its plaintext and binding. */
  readonly valueKeys: Map<string, { plain: string; binding: Binding }>;
}

const tenant: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };

/**
 * The unit of `KeysUnit`. Its named value keys imitate the adapters' (one key seals many values,
 * destroying it ends them all); the conformance case `namedValueKeyCases`
 * (packages/testing/src/conformance/adapter/named-value-key-cases.ts) proves that behaviour.
 */
function keysUnit(scope: Scope = tenant): KeysUnit {
  const subjects = new Map<string, DataKey | 'shredded'>();
  const valueKeys = new Map<string, { plain: string; binding: Binding }>();
  const plains: string[] = [];
  const decoder = new TextDecoder();
  const keys = {
    dataKey: (subjectId: string, options: { create: boolean }): Promise<DataKey | undefined> => {
      const held = subjects.get(subjectId);
      if (held === 'shredded') return Promise.resolve(undefined);
      if (held !== undefined) return Promise.resolve(held);
      if (!options.create) return Promise.resolve(undefined);
      const key: DataKey = {
        id: `dk_${subjects.size + 1}`,
        material: new Uint8Array(32).fill(subjects.size + 1),
      };
      subjects.set(subjectId, key);
      return Promise.resolve(key);
    },
    keyById: (keyId: string): Promise<DataKey | undefined> => {
      for (const held of subjects.values()) {
        if (held !== 'shredded' && held.id === keyId) return Promise.resolve(held);
      }
      return Promise.resolve(undefined);
    },
    sealValue: (
      binding: Binding,
      plain: Uint8Array,
      options?: { readonly keyId: string },
    ): Promise<SealedValue> => {
      const keyId = options?.keyId ?? `vk_${valueKeys.size + 1}`;
      // A named key seals many values: each keeps its own plaintext, found by its ciphertext.
      const kept = valueKeys.get(keyId);
      valueKeys.set(keyId, { plain: decoder.decode(plain), binding: kept?.binding ?? binding });
      plains.push(decoder.decode(plain));
      return Promise.resolve({
        keyId,
        nonce: new Uint8Array(12),
        ciphertext: new Uint8Array([plains.length - 1]),
      });
    },
    openValue: (sealed: SealedValue, expected?: Binding): Promise<Uint8Array | undefined> => {
      const held = valueKeys.get(sealed.keyId);
      if (held === undefined) return Promise.resolve(undefined);
      if (
        expected !== undefined &&
        (held.binding.entity !== expected.entity ||
          held.binding.id !== expected.id ||
          held.binding.field !== expected.field)
      ) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(
        new TextEncoder().encode(plains[sealed.ciphertext[0] ?? 0] ?? held.plain),
      );
    },
  };
  const unit = { scope, namespace: { id: 'ns-1' }, keys } as unknown as Unit;
  return {
    unit,
    valueKeys,
    shred: (subjectId) => {
      subjects.set(subjectId, 'shredded');
    },
  };
}

export type { KeysUnit };
export { keysUnit };
