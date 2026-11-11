import { readFileSync } from 'node:fs';
import type { SubjectId } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { probeInput } from './support/hooks-kit.ts';
import { attemptsOf, drainHooks, effectOf, rowsOf } from './support/hooks-reads.ts';
import { watchedHooks } from './support/watched-hooks.ts';

const start = Temporal.Instant.from('2026-03-01T08:00:00Z');
const owner = crypto.randomUUID() as SubjectId;
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

/** A value as JSON text would carry it, with the ids and instants that differ from run to run named. */
function plain(value: unknown, names: ReadonlyMap<string, string> = new Map()): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, member: unknown) => {
      if (typeof member === 'bigint') return `${member}n`;
      if (typeof member === 'string') return names.get(member) ?? member;
      return member;
    }),
  );
}

/** Compares `value` with the committed file `golden/<name>.json`. */
function golden(name: string, value: unknown): void {
  const path = new URL(`./golden/${name}.json`, import.meta.url);
  expect(value).toEqual(JSON.parse(readFileSync(path, 'utf8')));
}

/** The data of the settled event of an effect, the record the stream keeps. */
async function settledData(
  booted: Awaited<ReturnType<typeof watchedHooks>>,
  id: string,
): Promise<unknown> {
  const events = await booted.raw((unit) => unit.events.readStream({ type: 'core.effect', id }));
  return events.at(-1)?.data;
}

describe('the stored formats of a settled effect (F-25, S-169)', () => {
  test('the settled event of a succeeded, a failed and an abandoned effect', async () => {
    const booted = await watchedHooks(start, cleanup);
    await booted.client.invoke('hooks.notify', { payload: '{"n":1}' });
    await booted.client.invoke('probes.run', probeInput(owner, 'validation'));
    await drainHooks(booted);
    // The third effect acts, then its worker loses the lease, so the next taker abandons it.
    let completions = 0;
    booted.spy.complete = () => (completions++ === 0 ? false : undefined);
    await booted.client.invoke('probes.run', probeInput(owner, 'attempt', { group: 'late' }));
    await drainHooks(booted);
    await booted.runtime.advanceTo(start.add({ minutes: 2 }));
    await drainHooks(booted);

    const succeeded = await effectOf(booted, 'hooks.post');
    const rows = await rowsOf(booted, 'core.effect');
    const failedRow = rows.find((row) => row.status === 'failed');
    const abandoned = rows.find((row) => row.status === 'abandoned');
    expect([succeeded?.status, failedRow?.status, abandoned?.status]).toEqual([
      'succeeded',
      'failed',
      'abandoned',
    ]);
    const requestIds = new Map<string, string>();
    for (const row of [failedRow, abandoned]) {
      const error = row?.error as { requestId: string } | undefined;
      if (error !== undefined) requestIds.set(error.requestId, '<request id>');
    }
    golden('effect-settled-event-data', {
      succeeded: plain(await settledData(booted, String(succeeded?.id)), requestIds),
      failed: plain(await settledData(booted, String(failedRow?.id)), requestIds),
      abandoned: plain(await settledData(booted, String(abandoned?.id)), requestIds),
    });
  });

  test('the start and the end record of an attempt, and the history error of a failed effect job', async () => {
    const booted = await watchedHooks(start, cleanup);
    await booted.client.invoke('probes.run', probeInput(owner, 'validation'));
    await drainHooks(booted);
    const effect = await effectOf(booted, 'probes.act');
    const records = await attemptsOf(booted, String(effect?.id));
    const names = new Map<string, string>();
    for (const record of records) {
      names.set(String(record.process), '<process id>');
      names.set(String(record.build), '<build id>');
      const error = record.error as { requestId?: string } | undefined;
      if (error?.requestId !== undefined) names.set(error.requestId, '<request id>');
    }
    golden('effect-attempt-records', plain(records, names));
    const failures = booted.spy.completions.filter(
      (completion) => completion.outcome.kind === 'failed',
    );
    expect(failures).toHaveLength(1);
    golden('effect-job-history-error', plain(failures[0]?.outcome, names));
  });
});
