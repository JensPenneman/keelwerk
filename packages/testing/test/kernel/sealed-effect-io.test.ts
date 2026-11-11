import {
  defineApp,
  defineEffect,
  defineModule,
  defineModuleBase,
  field,
  shape,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { findPlaintext } from '../../src/dump/find-plaintext.ts';
import {
  bootCourier,
  dottedSubjectCase,
  dump,
  owner,
  personalInputCase,
  storedCourier,
  subjectLine,
  user,
} from './support/sealed-effect-kit.ts';

describe.each(['memory', 'pglite'] as const)(
  'sealed effect input and output on %s (S-127)',
  (kind) => {
    test('the hooks sketch effect and a personal effect compose and record requested with no plaintext in a dump', {
      timeout: 90_000,
    }, async () => {
      const booted = await bootCourier(kind);
      const commandId = crypto.randomUUID();
      await booted.client.invoke(
        'courier.send',
        { owner, subject: subjectLine, to: user },
        { commandId },
      );
      const result = await storedCourier(booted);
      expect(result.rows['core.effect']).toHaveLength(2);
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0]?.run).toEqual({
        executor: 'courier.post',
        effect: result.rows['core.effect']?.find((effect) => effect.type === 'courier.post')?.id,
      });
      const receipt = await booted.raw((unit) => unit.receipts.get(commandId));
      const text = dump({ ...result, receipt });
      expect(findPlaintext(text, [user, 'plain-signing-key-1', subjectLine])).toEqual([]);
      expect(text).toContain('kwv1.');
      await booted.runtime.stop();
    });

    test('the created event and the state row of a row sealed through a row of the same decision carry the subject key', {
      timeout: 90_000,
    }, async () => {
      const booted = await bootCourier(kind);
      await booted.client.invoke('courier.open', { owner, subject: subjectLine });
      const result = await storedCourier(booted, ['courier.account', 'courier.message']);
      const key = await booted.raw((unit) => unit.keys.dataKey(owner, { create: false }));
      expect(key).toBeDefined();
      const [row] = result.rows['courier.message'] ?? [];
      expect(row?.subject).toBeInstanceOf(Uint8Array);
      const created = result.events.find((event) => event.type === 'courier.message.created');
      const values = (created?.data ?? {}) as { values?: { subject?: unknown } };
      expect(values.values?.subject).toMatchObject({ $kwe: 1, k: key?.id });
      expect(dump(result)).not.toContain(subjectLine);
      await booted.runtime.stop();
    });

    test('a dotted dataSubject through rows the same decision creates seals the effect input and its record events', {
      timeout: 90_000,
    }, async () => {
      const booted = await bootCourier(kind);
      await dottedSubjectCase(booted);
      await booted.runtime.stop();
    });

    test('a row a later draft creates is no hop: the command fails with validation and writes nothing', {
      timeout: 90_000,
    }, async () => {
      const booted = await bootCourier(kind);
      const attempt = await booted.client.attempt('courier.sendReversed', {
        owner,
        subject: subjectLine,
        to: user,
      });
      expect(attempt).toMatchObject({
        ok: false,
        error: { kind: 'validation', issues: [{ path: ['subject'] }] },
      });
      const result = await storedCourier(booted, ['courier.account', 'courier.message']);
      expect(result.rows['courier.message']).toEqual([]);
      expect(result.rows['courier.account']).toEqual([]);
      await booted.runtime.stop();
    });

    test('personal effect input opens only through the subject key', {
      timeout: 90_000,
    }, async () => {
      const booted = await bootCourier(kind);
      await personalInputCase(booted);
      await booted.runtime.stop();
    });

    test('a secret command output is sealed in its receipt and answered again on replay', {
      timeout: 90_000,
    }, async () => {
      const booted = await bootCourier(kind);
      const commandId = crypto.randomUUID();
      const first = await booted.client.attempt('courier.issue', {}, { commandId });
      const second = await booted.client.attempt('courier.issue', {}, { commandId });
      expect(first).toMatchObject({ ok: true, value: { apiKey: 'plain-api-key-1' } });
      expect(second).toMatchObject({ ok: true, value: { apiKey: 'plain-api-key-1' } });
      const receipt = await booted.raw((unit) => unit.receipts.get(commandId));
      const text = dump(receipt);
      expect(text).toMatch(/kwv1\./);
      expect(text).not.toContain('plain-api-key-1');
      await booted.runtime.stop();
    });
  },
);

describe('a sealed value cannot be moved into another effect', () => {
  test('a reference from a client is refused and writes no effect', {
    timeout: 90_000,
  }, async () => {
    const booted = await bootCourier('memory');
    const foreign =
      'kwv1.0198a1e0-0000-7000-8000-00000000c001.CQkJCQkJCQkJCQkJ.AAAAAAAAAAAAAAAAAAAAAA';
    const attempt = await booted.client.attempt('courier.forward', {
      key: { ref: foreign } as never,
    });
    expect(attempt).toMatchObject({
      ok: false,
      error: {
        kind: 'validation',
        message: 'courier.post.signingKey takes a plain secret or a reference its module loaded.',
      },
    });
    const result = await storedCourier(booted, ['core.effect']);
    expect(result.rows['core.effect']).toEqual([]);
    const plain = await booted.client.attempt('courier.forward', { key: 'plain-signing-key-3' });
    expect(plain).toMatchObject({ ok: true });
    await booted.runtime.stop();
  });

  test('a with member the continuation declares secret is refused', {
    timeout: 90_000,
  }, async () => {
    const booted = await bootCourier('memory');
    const refusedAttempt = await booted.client.attempt('courier.chain', {
      token: 'plain-token-1',
      note: 'n',
    });
    expect(refusedAttempt).toMatchObject({
      ok: false,
      error: { code: 'core.request_not_allowed' },
    });
    const allowed = await booted.client.attempt('courier.chain', { note: 'a note' });
    expect(allowed).toMatchObject({ ok: true });
    const result = await storedCourier(booted, ['core.effect']);
    expect(result.rows['core.effect']).toHaveLength(1);
    expect(dump(result)).not.toContain('plain-token-1');
    await booted.runtime.stop();
  });
});

describe('effect declarations', () => {
  test('an effect with a personal input and no subject is refused at compose', () => {
    const base = defineModuleBase({ id: 'bare', version: '0.1.0' });
    const notify = defineEffect(base, {
      performer: 'external',
      input: shape({ to: field.string().personal() }),
    });
    const bare = defineModule(base, { effects: { notify } });
    expect(() => defineApp({ id: 'bare', modules: [bare] })).toThrow(/^effectInputNeedsSubject:/);
  });
});
