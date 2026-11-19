import { describe, expect, test } from 'vitest';
import { bootQuotas, setQuota } from './support/quota-kit.ts';
import { asOperator } from './support/targeting-kit.ts';

describe('core.quota.set refusals', () => {
  test('a tenant of another backend is refused for this backend, and nothing is stored', async () => {
    const runtime = await bootQuotas();
    const other = await asOperator(runtime, 'core.backend.create', {
      name: 'other',
      app: 'quota-app',
      placement: 'main',
    });
    if (!other.ok) throw other.error;
    const foreign = await asOperator(runtime, 'core.tenant.create', {
      backendId: other.value.id,
      name: 'initech',
      domains: ['initech.example.test'],
    });
    if (!foreign.ok) throw foreign.error;
    expect(
      await setQuota(runtime, {
        dimension: 'notes.noteBytes',
        backendId: runtime.backendId,
        tenantId: foreign.value.id,
        limit: '1MiB',
        reason: 'try',
      }),
    ).toMatchObject({ ok: false, error: { kind: 'validation', code: 'core.malformed_request' } });
    const rows = await asOperator(runtime, 'core.quota.query', {});
    expect(rows.ok && (rows.value as { items?: unknown[] }).items).toEqual([]);
  });

  test('a queue weight below 1 and a queue member above the integer range are refused, and nothing is stored', async () => {
    const runtime = await bootQuotas();
    const refused = { ok: false, error: { kind: 'validation', code: 'core.malformed_request' } };
    const base = {
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
      reason: 'try',
    };
    for (const input of [
      { dimension: 'queue:commands.weight', limit: '0' },
      { dimension: 'queue:commands.weight', limit: '2147483648' },
      { dimension: 'queue:commands.running', limit: '2147483648' },
    ]) {
      expect(await setQuota(runtime, { ...base, ...input }), JSON.stringify(input)).toMatchObject(
        refused,
      );
    }
    expect(
      await setQuota(runtime, { ...base, dimension: 'queue:commands.weight', limit: '1' }),
    ).toMatchObject({ ok: true });
    expect(
      await setQuota(runtime, { ...base, dimension: 'queue:commands.running', limit: '0' }),
    ).toMatchObject({ ok: true });
  });

  test('a set without a tenant is refused as validation and no row exists', async () => {
    const runtime = await bootQuotas();
    const base = { backendId: runtime.backendId, reason: 'x' };
    for (const input of [
      { dimension: 'queue:commands.weight', limit: '2147483647' },
      { dimension: 'notes.noteBytes', limit: '1MiB' },
      { dimension: 'notes.backendNotes', limit: '10' },
      { dimension: 'notes.noteBytes', limit: '1MiB', tenantId: '' },
    ]) {
      expect(await setQuota(runtime, { ...base, ...input }), JSON.stringify(input)).toMatchObject({
        ok: false,
        error: { kind: 'validation' },
      });
    }
    const rows = await asOperator(runtime, 'core.quota.query', {});
    expect(rows.ok && (rows.value as { items?: unknown[] }).items).toEqual([]);
  });
});
