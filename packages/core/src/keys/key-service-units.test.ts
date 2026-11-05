import { describe, expect, it } from 'vitest';
import { countingRandomSource } from '../../test/keys/counting-random-source.ts';
import { memoryScopeKeys } from '../../test/keys/memory-scope-keys.ts';
import { errors } from '../errors/errors.ts';
import { RetryableUnitError } from '../storage/retryable-unit-error.ts';
import type { ScopeKeyStore } from '../storage/scope-key-store.ts';
import type { WrappedScopeKey } from '../storage/wrapped-scope-key.ts';
import { createKeyService } from './create-key-service.ts';
import { isForkable } from './is-forkable.ts';

const master = { version: 3, material: new Uint8Array(32).fill(9) };
const scope = { level: 'deployment' } as const;

describe('a key service bound to a unit that races or forks', () => {
  const setupWithin = () => {
    const store = memoryScopeKeys();
    const service = createKeyService({
      master: { current: async () => master, byVersion: async () => master },
      deploymentId: 'dep',
      withScopeKeys: store.withScopeKeys,
      clock: { now: () => Temporal.Instant.from('2026-11-05T10:00:00Z') },
      random: countingRandomSource(),
    });
    return { service, store };
  };
  const unitStore = (committed: WrappedScopeKey[]) => {
    const staged: WrappedScopeKey[] = [];
    const store: ScopeKeyStore = {
      current: async (scopeId) =>
        [...committed, ...staged].filter((r) => r.scopeId === scopeId).at(-1),
      byVersion: async (scopeId, version) =>
        [...committed, ...staged].find((r) => r.scopeId === scopeId && r.version === version),
      add: async (key) => {
        staged.push(key);
      },
      retire: async () => undefined,
      destroy: async () => undefined,
    };
    return { store, commit: () => committed.push(...staged.splice(0)) };
  };

  it('a first key lost to a concurrent unit asks for the unit to rerun', async () => {
    const { service, store } = setupWithin();
    const lost = unitStore(store.rows);
    const failing: ScopeKeyStore = {
      ...lost.store,
      add: async () => {
        throw errors.conflict('A unique value is already taken.');
      },
    };
    await expect(service.within(failing).issue(scope, { prefix: 'kwo' })).rejects.toBeInstanceOf(
      RetryableUnitError,
    );
    // The rerun reads the committed row of the winner.
    const winner = await service.issue(scope, { prefix: 'kwo' });
    expect(
      await service
        .within(unitStore(store.rows).store)
        .verify(scope, winner.plain, winner.verifier),
    ).toBe(true);
  });

  it('a fork of a bound view overlays that unit, never the shared store', async () => {
    const { service, store } = setupWithin();
    const unit = unitStore(store.rows);
    const view = service.within(unit.store);
    if (!isForkable(view)) throw new Error('the view cannot fork');
    const forked = view.fork();
    const issued = await forked.issue(scope, { prefix: 'kwo' });
    expect(await forked.verify(scope, issued.plain, issued.verifier)).toBe(true);
    unit.commit();
    expect(store.rows).toHaveLength(0);
    expect(store.calls.count).toBe(0);
  });
});
