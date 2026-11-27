import type { StorageRow } from '@keelwerk/core';
import { afterEach, expect, test } from 'vitest';
import { type BootedSecretVault, bootSecretVault } from './support/effect-secrets-kit.ts';
import { useUpperDraws } from './support/use-upper-draws.ts';

useUpperDraws();

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

/** Changes what the input of an effect holds, below the write path: a sealed text moved from where it was sealed. */
async function moveInput(booted: BootedSecretVault, effect: StorageRow, values: object) {
  const descriptor = booted.runtime.app.registry.entities.get('core.effect')?.descriptor;
  if (descriptor === undefined) throw new Error('no core.effect');
  await booted.raw((unit) =>
    unit.rows.update(descriptor, [
      {
        id: String(effect.id),
        expectedVersion: Number(effect.version),
        values: { ...effect, input: { ...(effect.input as object), ...values } },
      },
    ]),
  );
}

test("a sealed value moved from another effect into an executor's input is refused by the reveal, and the settle does not destroy the key of the effect it came from", async () => {
  const booted = await bootSecretVault({ adapter: 'memory', watched: true }, cleanup);
  booted.spy.refuseTake = () => true;
  // The outside effect has no job: it stays requested, with its own key.
  const outside = await booted.open('outside', { external: true });
  const inside = await booted.open('ok');
  const { key } = booted.texts(await booted.effectRow(outside));
  await moveInput(booted, await booted.effectRow(inside), { key });
  booted.spy.refuseTake = undefined;
  await booted.drain();
  expect(await booted.effectRow(inside)).toMatchObject({
    status: 'failed',
    error: { code: 'core.not_found' },
  });
  expect(await booted.effectRow(outside)).toMatchObject({ status: 'requested' });
  // The moved text opens under no binding of the effect it was moved into: its settle named no key of it.
  expect(await booted.opens(key)).toBe(true);
  expect((await booted.rows('vault.ledger')).map((entry) => entry.proof)).toEqual([undefined]);
});

test("a sealed value moved from another member into an executor's input is refused by the reveal", async () => {
  const booted = await bootSecretVault({ adapter: 'memory', watched: true }, cleanup);
  booted.spy.refuseTake = () => true;
  const id = await booted.open('ok');
  const { backup } = booted.texts(await booted.effectRow(id));
  await moveInput(booted, await booted.effectRow(id), { key: backup });
  booted.spy.refuseTake = undefined;
  await booted.drain();
  expect(await booted.effectRow(id)).toMatchObject({
    status: 'failed',
    error: { code: 'core.not_found' },
  });
  expect((await booted.rows('vault.ledger')).map((entry) => entry.proof)).toEqual([undefined]);
  // The key of the member the text came from is destroyed at the settle, through that member.
  expect(await booted.opens(backup)).toBe(false);
});
