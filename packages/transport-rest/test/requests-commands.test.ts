import { commandReceiptId, KeelwerkError } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { lastCall } from './support/last-call.ts';
import { mountedRest } from './support/mounted-rest.ts';
import { portalSurface, withAction } from './support/portal-surface.ts';
import { profileRow as row } from './support/profile-row.ts';
import {
  call,
  fakeInvoker,
  mountRest,
  profileId,
  profileUuid,
  session,
} from './support/rest-kit.ts';

describe('command requests', () => {
  test('If-Match becomes ifVersion, and a failed precondition is 412', async () => {
    const { handler, calls } = await mountedRest(() => ({ ok: true, value: row }));
    const response = await call(handler, 'PATCH', `/api/accounts/profiles/${profileId}`, {
      headers: { 'if-match': '"3"', 'content-type': 'application/merge-patch+json' },
      body: { name: 'Grace', bio: null },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"3"');
    expect(lastCall(calls)).toMatchObject({
      action: 'accounts.profile.update',
      input: { id: profileUuid, patch: { name: 'Grace', bio: null }, ifVersion: 3 },
    });
    const conflicting = await call(handler, 'PATCH', `/api/accounts/profiles/${profileId}`, {
      headers: { 'if-match': '"3"' },
      body: { ifVersion: 2 },
    });
    expect(conflicting.status).toBe(422);
    const weak = await call(handler, 'PATCH', `/api/accounts/profiles/${profileId}`, {
      headers: { 'if-match': 'W/"3"' },
      body: {},
    });
    expect(weak.status).toBe(400);
    const badTag = await call(handler, 'PATCH', `/api/accounts/profiles/${profileId}`, {
      headers: { 'if-match': 'abc' },
      body: {},
    });
    expect(badTag.status).toBe(400);

    const failing = await mountedRest(() => ({
      ok: false,
      error: new KeelwerkError({
        kind: 'conflict',
        code: 'core.version_mismatch',
        message: 'The row changed since it was read.',
      }),
    }));
    const mismatch = await call(failing.handler, 'DELETE', `/api/accounts/profiles/${profileId}`, {
      headers: { 'if-match': '"1"' },
    });
    expect(mismatch.status).toBe(412);
    expect(await mismatch.json()).toMatchObject({
      code: 'core.version_mismatch',
      kind: 'conflict',
    });
  });

  test('create answers 201 with Location and ETag; archive and restore answer the row', async () => {
    const { handler, calls } = await mountedRest(() => ({ ok: true, value: row }));
    const created = await call(handler, 'POST', '/api/accounts/profiles', {
      body: { name: 'Ada' },
    });
    expect(created.status).toBe(201);
    expect(created.headers.get('location')).toBe(`/api/accounts/profiles/${profileId}`);
    expect(created.headers.get('etag')).toBe('"3"');
    expect(created.headers.get('keelwerk-command-id')).toMatch(/^[0-9a-f-]{36}$/);
    const archived = await call(handler, 'DELETE', `/api/accounts/profiles/${profileId}`);
    expect(archived.status).toBe(200);
    expect(lastCall(calls).input).toEqual({ id: profileUuid });
    const restored = await call(handler, 'POST', `/api/accounts/profiles/${profileId}/restore`);
    expect(restored.status).toBe(200);
    expect(lastCall(calls).action).toBe('accounts.profile.restore');
  });

  test('a command with void output answers 204 and lists its effects', async () => {
    const { handler, calls } = await mountedRest(() => ({
      ok: true,
      value: undefined,
      effects: ['eff_a', 'eff_b'],
    }));
    const response = await call(handler, 'POST', `/api/accounts/profiles/${profileId}/deactivate`, {
      body: { reason: 'left' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('keelwerk-effects')).toBe('eff_a,eff_b');
    expect(lastCall(calls).input).toEqual({ reason: 'left', id: profileUuid });
  });

  test('an accepted command answers 202 with Location and the receipt (S-24)', async () => {
    const { handler, calls } = await mountedRest((inv) => ({
      ok: true,
      value: undefined,
      receipt: { commandId: inv.commandId ?? '', status: 'accepted' },
    }));
    const response = await call(handler, 'POST', '/api/accounts/profiles', {
      headers: { prefer: 'respond-async, wait=10', 'idempotency-key': 'order-17' },
      body: { name: 'Ada' },
    });
    expect(response.status).toBe(202);
    const location = response.headers.get('location') ?? '';
    expect(location).toBe(`/api/core/command-receipts/${commandReceiptId('t1', 'order-17')}`);
    expect(location).toMatch(/^\/api\/core\/command-receipts\/rcpt_[0-9a-hjkmnpqrstv-z]{26}$/);
    expect(response.headers.get('preference-applied')).toBe('respond-async');
    expect(response.headers.get('keelwerk-command-id')).toBe('order-17');
    expect(await response.json()).toEqual({ commandId: 'order-17', status: 'accepted' });
    expect(lastCall(calls)).toMatchObject({ prefer: 'async', commandId: 'order-17' });

    const plain = await call(handler, 'POST', '/api/accounts/profiles', { body: { name: 'Ada' } });
    expect(plain.status).toBe(202);
    expect(plain.headers.has('preference-applied')).toBe(false);
    expect(lastCall(calls).prefer).toBeUndefined();
  });

  describe('the Location of an accepted command (S-102: receipt reads are tenant-scope until WP-55b)', () => {
    const accepted = (inv: { readonly commandId?: string }) => ({
      ok: true as const,
      value: undefined,
      receipt: { commandId: inv.commandId ?? '', status: 'accepted' as const },
    });
    const create = async (
      actionScope: 'tenant' | 'backend' | 'deployment',
      sessionScope: Parameters<typeof session>[0],
    ): Promise<Response> => {
      const fake = fakeInvoker(accepted);
      const { handler } = await mountRest(
        withAction(portalSurface(), 'accounts.profile.create', { scope: actionScope }),
        fake.invoker,
      );
      return call(handler, 'POST', '/api/accounts/profiles', {
        headers: { 'idempotency-key': 'order-18' },
        body: { name: 'Ada' },
        session: session(sessionScope),
      });
    };

    test('a tenant session running a tenant-scope command is told where its receipt is', async () => {
      const response = await create('tenant', {});
      expect(response.status).toBe(202);
      expect(response.headers.get('location')).toBe(
        `/api/core/command-receipts/${commandReceiptId('t1', 'order-18')}`,
      );
    });

    test('a backend-scope command of a tenant session answers 202 without a Location', async () => {
      const response = await create('backend', {});
      expect(response.status).toBe(202);
      expect(response.headers.has('location')).toBe(false);
      expect(await response.json()).toEqual({ commandId: 'order-18', status: 'accepted' });
    });

    test('a backend session gets no Location, since the receipt read refuses it', async () => {
      const response = await create('backend', { scope: { level: 'backend', backendId: 'b1' } });
      expect(response.status).toBe(202);
      expect(response.headers.has('location')).toBe(false);
    });

    test('a deployment session gets no Location either, and no link carries the deployment id', async () => {
      const response = await create('deployment', { scope: { level: 'deployment' } });
      expect(response.status).toBe(202);
      expect(response.headers.has('location')).toBe(false);
      expect(JSON.stringify([...response.headers])).not.toContain(
        commandReceiptId('0198a1e0-0000-7000-8000-00000000d001', 'order-18'),
      );
    });
  });

  test('Idempotency-Key is the command id, a replay says so', async () => {
    const { handler, calls } = await mountedRest(() => ({ ok: true, value: row, replayed: true }));
    const response = await call(handler, 'POST', '/api/accounts/profiles', {
      headers: { 'idempotency-key': 'k-1' },
      body: { name: 'Ada' },
    });
    expect(response.headers.get('idempotent-replayed')).toBe('true');
    expect(response.headers.get('keelwerk-command-id')).toBe('k-1');
    expect(lastCall(calls).commandId).toBe('k-1');
    const invalid = await call(handler, 'POST', '/api/accounts/profiles', {
      headers: { 'idempotency-key': 'has space' },
      body: { name: 'Ada' },
    });
    expect(invalid.status).toBe(400);
    const query = await call(handler, 'GET', '/api/app/health');
    expect(query.headers.has('keelwerk-command-id')).toBe(false);
    expect(lastCall(calls).commandId).toBeUndefined();
  });
});
