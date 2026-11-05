import { describe, expect, test } from 'vitest';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import {
  bearer,
  booted,
  call,
  issued,
  local,
  ok,
  operatorHost,
  probe,
  testClock,
} from './support/core-actions-kit.ts';
import { ada, boot, deploymentOf } from './support/runtime-kit.ts';

describe('operator tokens (section 3.5, S-32)', () => {
  test('issue answers the token once, expiring after 12 hours; the row keeps no secret', async () => {
    const runtime = await booted();
    const { id, token, expiresAt } = await issued(runtime);
    expect(token).toMatch(/^kwo_[a-z2-7]{26}_[a-z2-7]{52}$/);
    expect(expiresAt.toString()).toBe('2026-11-05T22:00:00Z');
    const listed = await ok(call(runtime.invoker, local, 'core.operatorToken.query'));
    const rows = listed.items as Record<string, unknown>[];
    expect(rows.map((row) => row.id)).toEqual([id]);
    expect(JSON.stringify(rows)).not.toContain(token.split('_')[2] ?? '?');
    expect(rows[0]).not.toHaveProperty('verifier');
  });

  test('a remote carrier with the token is an operator at the deployment scope', async () => {
    const runtime = await booted();
    const { id, token } = await issued(runtime);
    void id;
    const tokens = await ok(call(runtime.invoker, bearer(token), 'core.operatorToken.query'));
    expect((tokens.items as unknown[]).length).toBe(1);
  });

  test('a token is an operator credential at an operator host only', async () => {
    const runtime = await booted();
    const backend = await runtime.control.createBackend({
      name: 'library',
      app: 'library',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({
      backendId: backend.id,
      name: 'acme',
      domains: ['shop.example.test'],
    });
    const { token } = await issued(runtime);
    const elsewhere = bearer(token, 'shop.example.test');
    const session = await runtime.invoker.open(elsewhere);
    expect(session).toMatchObject({ ok: false, error: { kind: 'unauthenticated' } });
    expect(await call(runtime.invoker, elsewhere, probe)).toMatchObject({ ok: false });
    expect(await call(runtime.invoker, bearer(token, 'unknown.example.test'), probe)).toMatchObject(
      { ok: false },
    );
    expect(tenant.id).toBeTruthy();
    expect(
      await call(runtime.invoker, bearer(token, 'OPS.example.test:8443'), probe),
    ).toMatchObject({ ok: true });
  });

  test('a token does not issue tokens', async () => {
    const runtime = await booted();
    const { token } = await issued(runtime);
    expect(
      await call(runtime.invoker, bearer(token), 'core.operatorToken.issue', { label: 'again' }),
    ).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });

  test('an unknown, tampered, expired or revoked token is unauthenticated', async () => {
    const time = testClock();
    const runtime = await booted(time.clock);
    const { id, token } = await issued(runtime, { label: 'ci', ttl: '30m' });
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
    const unknown = `kwo_${'a'.repeat(26)}_${'a'.repeat(52)}`;
    for (const bad of [tampered, unknown, 'kwo_garbage']) {
      expect(await call(runtime.invoker, bearer(bad), probe), bad).toMatchObject({
        ok: false,
        error: { kind: 'unauthenticated' },
      });
    }
    await ok(call(runtime.invoker, bearer(token), 'core.operatorToken.revoke', { id }));
    expect(await call(runtime.invoker, bearer(token), probe)).toMatchObject({
      ok: false,
      error: { kind: 'unauthenticated' },
    });
    const second = await issued(runtime, { label: 'short', ttl: '30m' });
    expect(await call(runtime.invoker, bearer(second.token), probe)).toMatchObject({
      ok: true,
    });
    time.advance({ minutes: 31 });
    expect(await call(runtime.invoker, bearer(second.token), probe)).toMatchObject({
      ok: false,
      error: { kind: 'unauthenticated' },
    });
  });

  test('a lifetime outside one minute to 30 days is refused', async () => {
    const runtime = await booted();
    for (const ttl of ['10s', '31d', 'soon']) {
      expect(
        await call(runtime.invoker, local, 'core.operatorToken.issue', { label: 'x', ttl }),
        ttl,
      ).toMatchObject({ ok: false, error: { kind: 'validation' } });
    }
  });

  test('only operators issue tokens', async () => {
    const runtime = await booted();
    const backend = await runtime.control.createBackend({
      name: 'library',
      app: 'library',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
    const user = testCarrier({ name: 'acme', id: tenant.id }, ada);
    expect(
      await call(runtime.invoker, user, 'core.operatorToken.issue', { label: 'x' }),
    ).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });
});

describe.each(['memory', 'pglite'] as const)(
  'operator token issue on %s runs without a warm-up',
  (kind) => {
    test('the first deployment-scope issue creates the deployment key in its own unit', async () => {
      const runtime = await boot(deploymentOf(kind, { operator: { hosts: [operatorHost] } }), {
        clock: testClock().clock,
      });
      const first = await issued(runtime);
      const second = await issued(runtime, { label: 'again' });
      expect(first.token).toMatch(/^kwo_/);
      const bearerOk = await call(runtime.invoker, bearer(second.token), probe);
      expect(bearerOk).toMatchObject({ ok: true });
    }, 60_000);
  },
);

describe('the command that creates (F-11b change note)', () => {
  test('issue takes no instance id; revoke does', async () => {
    const runtime = await booted();
    const { actions } = runtime.registry('library');
    expect(actions.get('core.operatorToken.issue')).toMatchObject({
      instance: false,
      scope: 'deployment',
    });
    expect(actions.get('core.operatorToken.revoke')).toMatchObject({ instance: true });
    expect(
      await call(runtime.invoker, local, 'core.operatorToken.issue', { id: 'x', label: 'a' }),
    ).toMatchObject({
      ok: false,
      error: { kind: 'validation' },
    });
  });
});
