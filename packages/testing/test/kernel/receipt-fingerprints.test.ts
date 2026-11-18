import { createHash } from 'node:crypto';
import { canonicalizeJson } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { bootErasureRules, stopBooted } from './support/erasure-rules-kit.ts';
import { scopeOf } from './support/restart-kit.ts';

afterEach(stopBooted);

describe('the fingerprint of a command with a personal member (WP-130)', () => {
  const subscribed = '00000000-0000-7000-8000-000000000201';
  const opened = '00000000-0000-7000-8000-000000000202';
  const hex = /^[0-9a-f]{64}$/;

  /** The client of the probe app, loosely typed: the subject id of the input is built from text. */
  const asyncCall = async (
    booted: Awaited<ReturnType<typeof bootErasureRules>>,
    input: { readonly address: string; readonly ownerId: string },
    commandId: string = subscribed,
  ) =>
    (
      booted.operator as unknown as {
        attempt: (
          action: string,
          input: unknown,
          options: unknown,
        ) => Promise<{ ok: boolean; error?: { code: string } }>;
      }
    ).attempt('probe.subscribe', input, { commandId, prefer: 'async' });

  const receiptOf = (
    booted: Awaited<ReturnType<typeof bootErasureRules>>,
    commandId: string = subscribed,
  ) =>
    booted.runtime.adapter.unit(
      booted.runtime.namespace,
      scopeOf(booted.runtime),
      (unit) => unit.receipts.get(commandId),
      { readOnly: true },
    );

  test('an async command with a personal member is accepted, run and replayed with one fingerprint', {
    timeout: 60_000,
  }, async () => {
    const booted = await bootErasureRules();
    const input = { address: 'fingerprint.member@example.test', ownerId: booted.subject };
    expect(await asyncCall(booted, input)).toMatchObject({ ok: true });
    const accepted = await receiptOf(booted);
    expect(accepted?.status).toBe('accepted');
    expect(accepted?.fingerprint).toMatch(hex);
    expect(await booted.runtime.drainJobs()).toBe(1);
    const completed = await receiptOf(booted);
    expect(completed?.status).toBe('completed');
    expect(completed?.fingerprint).toBe(accepted?.fingerprint);
    // The same id and input is a replay of the receipt, not a mismatch and not a second run.
    expect(await asyncCall(booted, input)).toMatchObject({ ok: true });
    expect((await receiptOf(booted))?.fingerprint).toBe(accepted?.fingerprint);
    expect(await booted.runtime.drainJobs()).toBe(0);
  });

  test('a retry with a receipt in the 0.1.0 form answers core.idempotency_mismatch', {
    timeout: 60_000,
  }, async () => {
    const booted = await bootErasureRules();
    const input = { address: 'fingerprint.member@example.test', ownerId: booted.subject };
    // A receipt as 0.1.0 wrote it: the plain digest of the canonical input, under the id of the
    // retry.
    expect(await asyncCall(booted, input, opened)).toMatchObject({ ok: true });
    const keyed = await receiptOf(booted, opened);
    if (keyed === undefined) throw new Error('the receipt is missing');
    const plain = createHash('sha256')
      .update(canonicalizeJson({ action: 'probe.subscribe', apiVersion: keyed.apiVersion, input }))
      .digest('hex');
    expect(plain).not.toBe(keyed.fingerprint);
    await booted.runtime.adapter.unit(booted.runtime.namespace, scopeOf(booted.runtime), (unit) =>
      unit.receipts.put({ ...keyed, commandId: subscribed, fingerprint: plain }),
    );
    expect(await asyncCall(booted, input, subscribed)).toMatchObject({
      ok: false,
      error: { code: 'core.idempotency_mismatch' },
    });
  });
});
