import { createComputePool, entityBehavioursOf, normalizeRule } from '@keelwerk/core';
import { readAsOfPosition, redecide } from '@keelwerk/core/replay';
import { afterEach, describe, expect, test } from 'vitest';
import { expectReproduces } from '../../src/replay/expect-reproduces.ts';
import { tenantAddress } from '../../src/replay/tenant-address.ts';
import { type BootedKeep, bootKeep } from './support/replay-kit.ts';

const password = 'a long enough pass phrase';
const next = 'another long pass phrase';
const booted: BootedKeep[] = [];

afterEach(async () => {
  await Promise.all(booted.splice(0).map((keep) => keep.runtime.stop()));
});

interface Issued {
  readonly id: string;
  readonly token: string;
}

describe.each(['memory', 'pglite'] as const)(
  're-deciding state entities and keys on %s',
  (kind) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    async function boot(): Promise<BootedKeep> {
      const keep = await bootKeep(kind);
      booted.push(keep);
      return keep;
    }

    /** Re-decides without asserting the outcome, to look at a refusal. */
    async function redecided(keep: BootedKeep, commandId: string, input: unknown) {
      const { runtime } = keep;
      const address = tenantAddress(runtime);
      const compute = createComputePool({ size: 1 });
      return redecide({
        registry: runtime.app.registry,
        adapter: runtime.sealed,
        namespace: address.namespace,
        scope: address.scope,
        commandId,
        input,
        apiVersion: runtime.head,
        behaviours: entityBehavioursOf(runtime.app.modules),
        rules: [...runtime.app.registry.rules.values()].map(normalizeRule),
        keys: runtime.keys,
        compute,
        clock: runtime.clock,
        log: runtime.log,
        trace: runtime.tracer.startSpan('redecide'),
      }).finally(() => compute.close());
    }

    test('a redeemed ticket re-decides: the row is folded back from its change records', {
      timeout,
    }, async () => {
      const keep = await boot();
      const issued = (await keep.call<Issued>('keep.issue', {})).value;
      const redeemed = await keep.call('keep.redeem', { token: issued.token });
      const result = await expectReproduces(keep.runtime, {
        commandId: redeemed.commandId,
        input: { token: issued.token },
      });
      expect(result.reproduced).toBe(true);
      expect(result.recorded.events).toHaveLength(1);
    });

    test('a decision older than the feed horizon is refused for its state reads', {
      timeout,
    }, async () => {
      const keep = await boot();
      const issued = (await keep.call<Issued>('keep.issue', {})).value;
      const redeemed = await keep.call('keep.redeem', { token: issued.token });
      keep.clock.advance(24 * 6);
      expect((await redecided(keep, redeemed.commandId, { token: issued.token })).reproduced).toBe(
        true,
      );
      keep.clock.advance(24 * 2);
      const result = await redecided(keep, redeemed.commandId, { token: issued.token });
      expect(result.reproduced).toBe(false);
      expect(result.refused).toBe('core.replay_outside_horizon');
      expect(result.differences[0]).toContain('cannot re-decide');
    });

    test('a row changed after the read folds back, an unchanged one is the row of the table', {
      timeout,
    }, async () => {
      const keep = await boot();
      const first = (await keep.call<Issued>('keep.issue', {})).value;
      const second = (await keep.call<Issued>('keep.issue', {})).value;
      await keep.call('keep.redeem', { token: first.token });
      const { runtime } = keep;
      const entry = runtime.app.registry.entities.get('keep.ticket');
      if (entry === undefined) throw new Error('no ticket');
      const address = tenantAddress(runtime);
      const at = (position: bigint) =>
        runtime.adapter.unit(address.namespace, address.scope, (unit) =>
          readAsOfPosition({
            unit,
            entry,
            behaviours: entityBehavioursOf(runtime.app.modules),
            at: position,
          }),
        );
      const head = await runtime.adapter.unit(address.namespace, address.scope, (unit) =>
        unit.events.head(),
      );
      expect(head).toBe(3n);
      expect(await at(0n)).toEqual([]);
      expect((await at(1n)).map((row) => row.id)).toEqual([first.id]);
      const before = await at(2n);
      expect(before.map((row) => row.id).toSorted()).toEqual([first.id, second.id].toSorted());
      const folded = before.find((row) => row.id === first.id);
      expect(folded?.usedAt ?? null).toBeNull();
      expect(Number(folded?.version)).toBe(1);
      const now = await at(3n);
      expect(now.find((row) => row.id === first.id)?.usedAt).toBeDefined();
      expect(Number(now.find((row) => row.id === first.id)?.version)).toBe(2);
      const table = await runtime.adapter.unit(address.namespace, address.scope, (unit) =>
        unit.rows.find(entry.descriptor, { includeArchived: true }),
      );
      expect(before.find((row) => row.id === second.id)).toEqual(
        table.rows.find((row) => row.id === second.id),
      );
    });

    test('a row hard-deleted after the read is still folded back', { timeout }, async () => {
      const keep = await boot();
      const first = (await keep.call<Issued>('keep.issue', {})).value;
      const second = (await keep.call<Issued>('keep.issue', {})).value;
      await keep.call('keep.redeem', { token: first.token });
      const { runtime } = keep;
      const entry = runtime.app.registry.entities.get('keep.ticket');
      if (entry === undefined) throw new Error('no ticket');
      const address = tenantAddress(runtime);
      const purged = await runtime.adapter.unit(address.namespace, address.scope, (unit) =>
        unit.rows.purge(entry.descriptor, [first.id]),
      );
      expect(purged).toBe(1);
      const before = await runtime.adapter.unit(address.namespace, address.scope, (unit) =>
        readAsOfPosition({
          unit,
          entry,
          behaviours: entityBehavioursOf(runtime.app.modules),
          at: 2n,
        }),
      );
      expect(before.map((row) => row.id).toSorted()).toEqual([first.id, second.id].toSorted());
      expect(Number(before.find((row) => row.id === first.id)?.version)).toBe(1);
    });

    test('a use of a vault re-decides with the real verification', { timeout }, async () => {
      const keep = await boot();
      const vault = (await keep.call<{ id: string }>('keep.enrol', { password })).value;
      const input = { id: vault.id, password };
      const used = await keep.call('keep.use', input);
      const result = await expectReproduces(keep.runtime, { commandId: used.commandId, input });
      expect(result.reproduced).toBe(true);
    });

    test('a rotation destroys the key of the old verifier, and what read it is refused', {
      timeout,
    }, async () => {
      const keep = await boot();
      const vault = (await keep.call<{ id: string }>('keep.enrol', { password })).value;
      const useInput = { id: vault.id, password };
      const used = await keep.call('keep.use', useInput);
      const rotateInput = { id: vault.id, password, next };
      const rotated = await keep.call('keep.rotate', rotateInput);
      const refusedRotate = await redecided(keep, rotated.commandId, rotateInput);
      expect(refusedRotate.reproduced).toBe(false);
      expect(refusedRotate.refused).toBe('core.replay_key_destroyed');
      const refusedUse = await redecided(keep, used.commandId, useInput);
      expect(refusedUse.refused).toBe('core.replay_key_destroyed');
    });
  },
);
