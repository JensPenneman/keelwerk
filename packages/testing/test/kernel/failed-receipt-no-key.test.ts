import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, test } from 'vitest';
import { pgliteQuery } from './support/dump-sections.ts';
import { rowsOf } from './support/erasure-dump-tools.ts';
import { bootErasureRules, stopBooted } from './support/erasure-rules-kit.ts';
import { scopeOf } from './support/restart-kit.ts';

afterEach(stopBooted);

type Booted = Awaited<ReturnType<typeof bootErasureRules>>;
type Answer = {
  ok: boolean;
  value?: unknown;
  error?: { code: string; message?: string };
};

/** A client call with loosely typed input: the ids of the cases are built from text. */
const attempt = (
  client: Booted['operator'],
  action: string,
  input: unknown,
  commandId: string,
): Promise<Answer> =>
  (
    client as unknown as {
      attempt: (action: string, input: unknown, options: unknown) => Promise<Answer>;
    }
  ).attempt(action, input, { commandId });

const receiptOf = (booted: Booted, commandId: string) =>
  booted.runtime.adapter.unit(
    booted.runtime.namespace,
    scopeOf(booted.runtime),
    (unit) => unit.receipts.get(commandId),
    { readOnly: true },
  );

/** The rows of the data keys that name `subject`. */
const keysOf = async (booted: Booted, subject: string) =>
  (await rowsOf([pgliteQuery(booted.runtime.adapter)], 'kw_subject_keys')).filter((row) =>
    JSON.stringify(row).includes(subject),
  );

const keyedFingerprint = /^kwf1\.[0-9a-f]{64}$/;

describe('a failed command is pinned by its receipt and creates no data key (WP-158)', () => {
  test('a refused generated update with a fresh id leaves no key and records its failed receipt', {
    timeout: 60_000,
  }, async () => {
    const booted = await bootErasureRules('pglite');
    const subject = randomUUID();
    const commandId = randomUUID();
    const answer = await attempt(
      booted.operator,
      'probe.person.update',
      { id: subject, patch: { notes: 'x' } },
      commandId,
    );
    expect(answer.ok).toBe(false);
    expect(await keysOf(booted, subject)).toEqual([]);
    const receipt = await receiptOf(booted, commandId);
    expect(receipt?.status).toBe('failed');
    expect(receipt?.fingerprint).toMatch(keyedFingerprint);
  });

  test('a generated set whose create item carries an id leaves no key and no failed receipt', {
    timeout: 60_000,
  }, async () => {
    const booted = await bootErasureRules('pglite');
    const subject = randomUUID();
    const commandId = randomUUID();
    const answer = await attempt(
      booted.operator,
      'probe.person.set',
      { create: [{ id: subject, name: 'Bea', email: 'failed.set@example.test' }] },
      commandId,
    );
    // A set answers each refused item inside a command that ran: the receipt is the completed one.
    expect(answer).toMatchObject({ ok: true, value: { failed: [{ operation: 'create' }] } });
    expect(await keysOf(booted, subject)).toEqual([]);
    expect((await receiptOf(booted, commandId))?.status).toBe('completed');
  });

  test('a failed module command whose personal member names an input id leaves no key and records its failed receipt', {
    timeout: 60_000,
  }, async () => {
    const booted = await bootErasureRules('pglite');
    const subject = randomUUID();
    const commandId = randomUUID();
    const input = { ownerId: subject, email: 'failed.claim@example.test' };
    const first = await attempt(booted.operator, 'probe.claim', input, commandId);
    expect(first).toMatchObject({ ok: false, error: { code: 'probe.email_taken' } });
    expect(await keysOf(booted, subject)).toEqual([]);
    const receipt = await receiptOf(booted, commandId);
    expect(receipt?.status).toBe('failed');
    expect(receipt?.fingerprint).toMatch(keyedFingerprint);
    // The retry is the stored answer, and it creates no key either.
    const retry = await attempt(booted.operator, 'probe.claim', input, commandId);
    expect(retry).toMatchObject({ ok: false, error: { code: 'probe.email_taken' } });
    expect(await keysOf(booted, subject)).toEqual([]);
  });

  test('a failed command on a subject that has a key is pinned and a retry is answered from it', {
    timeout: 60_000,
  }, async () => {
    const booted = await bootErasureRules('pglite');
    expect(await keysOf(booted, booted.subject)).toHaveLength(1);
    const commandId = randomUUID();
    const input = { ownerId: booted.subject, email: 'failed.pinned@example.test' };
    const first = await attempt(booted.operator, 'probe.claim', input, commandId);
    expect(first).toMatchObject({ ok: false, error: { code: 'probe.email_taken' } });
    expect((await receiptOf(booted, commandId))?.status).toBe('failed');
    // The live answer keeps the text of the declared error; the stored one is a closed projection.
    expect(first.error?.message).toBe('That address is taken.');
    const retry = await attempt(booted.operator, 'probe.claim', input, commandId);
    expect(retry, 'the retry is the stored answer, not a second run').toMatchObject({
      ok: false,
      error: { code: 'probe.email_taken', message: 'The command failed with probe.email_taken.' },
    });
  });
});
