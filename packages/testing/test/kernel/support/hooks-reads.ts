import type { StorageRow } from '@keelwerk/core';
import type { BootedHooks } from './hooks-kit.ts';

/** The rows of an entity, read below the sealing layer. */
export async function rowsOf(booted: BootedHooks, entity: string): Promise<readonly StorageRow[]> {
  const entry = booted.runtime.app.registry.entities.get(entity);
  if (entry === undefined) throw new Error(`no entity ${entity}`);
  return booted.raw(async (unit) => (await unit.rows.find(entry.descriptor, {})).rows);
}

/** The first effect record of a type. */
export async function effectOf(booted: BootedHooks, type: string): Promise<StorageRow | undefined> {
  return (await rowsOf(booted, 'core.effect')).find((row) => row.type === type);
}

/** The attempt records of an effect, in order, as stored. */
export async function attemptsOf(
  booted: BootedHooks,
  effectId: string,
): Promise<readonly Record<string, unknown>[]> {
  const records = await booted.raw((unit) =>
    unit.streams.read('core.effectAttempt', effectId, null, 100),
  );
  return records.map((record) => record.data as Record<string, unknown>);
}

/** Drains the workers a few times: an effect job, its retry or continuation, and the continuation's own wake-up. */
export async function drainHooks(booted: BootedHooks): Promise<void> {
  for (let round = 0; round < 6; round += 1) await booted.runtime.drainJobs();
}
