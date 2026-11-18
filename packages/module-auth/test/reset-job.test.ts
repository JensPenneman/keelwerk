import { testOperator } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { ada } from './support/auth-calls.ts';
import type { StorageKind } from './support/boot-auth.ts';
import { type BootedBoth, bootBoth } from './support/boot-both.ts';
import { holdJobs } from './support/hold-jobs.ts';
import { delivered } from './support/mailbox/delivered.ts';
import { watchUnits } from './support/watch-units.ts';

describe.each(['memory', 'pglite'] as const)('the reset job on %s', (kind: StorageKind) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<BootedBoth> {
    delivered.length = 0;
    const both = await bootBoth(kind);
    onTestFinished(() => both.runtime.stop());
    const done = await both.request('auth.signUp', ada);
    if (!done.ok) throw done.error;
    await both.settle();
    return both;
  }

  // A unit of the request reads rows (the event worker's own units read the log only). Every store
  // call counts, the key store's too: the lookup of an unknown identifier reads the decoy key where
  // a known one reads the key of its sealed identifier.
  const requestUnits = (watch: { units: string[][] }): string[][] =>
    watch.units.filter((calls) => calls.some((name) => /^unit\.rows\./.test(name)));

  test('a known and an unknown identifier make the same store calls in the request unit', {
    timeout,
  }, async () => {
    const both = await boot();
    holdJobs(both.runtime.adapter);
    const watch = watchUnits(both);
    const unknown = await both.request('auth.requestPasswordReset', {
      identifier: 'nobody@example.org',
    });
    const forUnknown = requestUnits(watch);
    watch.units.length = 0;
    const known = await both.request('auth.requestPasswordReset', { identifier: ada.identifier });
    const forKnown = requestUnits(watch);
    expect(known).toEqual(unknown);
    expect(forKnown.length).toBeGreaterThan(0);
    expect(forKnown).toEqual(forUnknown);
    expect(forKnown.flat().filter((name) => name === 'unit.rows.insert')).toEqual([]);
  });

  test('the token is delivered when the job runs, not in the request', { timeout }, async () => {
    const both = await boot();
    const held = holdJobs(both.runtime.adapter);
    await both.request('auth.requestPasswordReset', { identifier: ada.identifier });
    expect(await both.rows('auth.resetToken')).toHaveLength(0);
    expect(delivered).toHaveLength(0);
    held.release();
    await both.settle();
    expect(await both.rows('auth.resetToken')).toHaveLength(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.identifier).toBe(ada.identifier);
  });

  test('the job of an unknown identifier stores and delivers nothing', { timeout }, async () => {
    const both = await boot();
    const held = holdJobs(both.runtime.adapter);
    await both.request('auth.requestPasswordReset', { identifier: 'nobody@example.org' });
    held.release();
    await both.settle();
    expect(held.outcomes.map((outcome) => outcome.kind)).toContain('succeeded');
    expect(await both.rows('auth.resetToken')).toHaveLength(0);
    expect(delivered).toHaveLength(0);
  });

  const request = (both: BootedBoth, identifier = ada.identifier) =>
    both.request('auth.requestPasswordReset', { identifier });
  const reset = async (both: BootedBoth, token: string) => {
    const done = await both.request('auth.resetPassword', {
      token,
      newPassword: 'a brand new long password',
    });
    return done.ok ? 'reset' : done.error.code;
  };

  test('an older link no longer works after a newer one was issued', { timeout }, async () => {
    const both = await boot();
    await request(both);
    await both.settle();
    both.clock.advance({ minutes: 2 });
    await request(both);
    await both.settle();
    expect(delivered).toHaveLength(2);
    const [older, newer] = delivered;
    expect(await reset(both, older?.token ?? '')).toBe('auth.reset_token_invalid');
    expect(await reset(both, newer?.token ?? '')).toBe('reset');
  });

  test('an operator link retires the delivered one before it', { timeout }, async () => {
    const both = await boot();
    await request(both);
    await both.settle();
    const issued = await both
      .client(testOperator())
      .invoke('auth.issueResetLink', { identifier: ada.identifier });
    expect(await reset(both, delivered[0]?.token ?? '')).toBe('auth.reset_token_invalid');
    expect(await reset(both, issued.token)).toBe('reset');
  });

  test('the request after the cap answers as always and delivers nothing, until the hour has passed', {
    timeout,
  }, async () => {
    const both = await boot();
    for (let index = 0; index < 3; index += 1) {
      both.clock.advance({ minutes: 1 });
      expect((await request(both)).ok).toBe(true);
      await both.settle();
    }
    expect(delivered).toHaveLength(3);
    both.clock.advance({ minutes: 1 });
    const capped = await request(both);
    expect(capped.ok ? capped.value : capped.error.code).toEqual({ accepted: true });
    await both.settle();
    expect(delivered).toHaveLength(3);
    expect(await both.rows('auth.resetToken')).toHaveLength(3);
    // The link of the last delivery still works: the capped request retired nothing.
    expect(await reset(both, delivered[2]?.token ?? '')).toBe('reset');
    both.clock.advance({ hours: 1 });
    await request(both);
    await both.settle();
    expect(delivered).toHaveLength(4);
  });

  test('the cap is configuration', { timeout }, async () => {
    delivered.length = 0;
    const both = await bootBoth(kind, { auth: { resetRequestsPerHour: 1 } });
    onTestFinished(() => both.runtime.stop());
    expect((await both.request('auth.signUp', ada)).ok).toBe(true);
    await request(both);
    await both.settle();
    both.clock.advance({ minutes: 1 });
    await request(both);
    await both.settle();
    expect(delivered).toHaveLength(1);
  });

  test('with the cap reached, a known and an unknown identifier still make the same store calls', {
    timeout,
  }, async () => {
    const both = await boot();
    for (let index = 0; index < 3; index += 1) {
      both.clock.advance({ minutes: 1 });
      await request(both);
      await both.settle();
    }
    holdJobs(both.runtime.adapter);
    const watch = watchUnits(both);
    await request(both, 'nobody@example.org');
    const forUnknown = requestUnits(watch);
    watch.units.length = 0;
    await request(both);
    const forKnown = requestUnits(watch);
    expect(forKnown.length).toBeGreaterThan(0);
    expect(forKnown).toEqual(forUnknown);
  });
});
