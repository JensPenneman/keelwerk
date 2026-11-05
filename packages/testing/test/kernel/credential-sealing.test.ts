import { parseSealedValueText } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { bootVault } from './support/vault-kit.ts';

const apiKey = 'sk-live-0123456789-plain';
const replacement = 'sk-live-9876543210-newer';

/** Everything a value holds as text, bytes as base64 and big integers as decimals. */
const dump = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    member instanceof Uint8Array
      ? Buffer.from(member).toString('base64')
      : typeof member === 'bigint'
        ? member.toString()
        : member,
  );

describe.each(['memory', 'pglite'] as const)('credential sealing on %s (14.7.4)', (kind) => {
  test('secret and verifier values are sealed in state and events, a replaced value loses its key', {
    timeout: 60_000,
  }, async () => {
    const vault = await bootVault(kind);
    const stored = await vault.call<{ credentialId: string; token: string }>('vault.store', {
      label: 'ci',
      apiKey,
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const { credentialId, token } = stored.value;

    const first = await vault.raw(async (view) => {
      const [row] = await view.rows();
      const events = await view.events(credentialId);
      return { row, events };
    });
    // State: sealed values with their own value keys, no plaintext anywhere.
    const secret = first.row?.apiKey as { keyId: string };
    const verifier = first.row?.tokenVerifier as string;
    expect(secret.keyId).toEqual(expect.any(String));
    expect(verifier).toMatch(/^kwv1\.[^.]+\.[^.]+\.[^.]+$/);
    expect(verifier).not.toContain(secret.keyId);
    const wire = dump(first);
    expect(wire).not.toContain(apiKey);
    expect(wire).not.toContain(token);
    // Events: the sealed text.
    const created = first.events[0]?.data as { values: Record<string, string> };
    expect(created.values.apiKey).toMatch(/^kwv1\.[^.]+\.[^.]+\.[^.]+$/);
    expect(created.values.tokenVerifier).toMatch(/^kwv1\./);
    expect(dump(first.events)).not.toContain(apiKey);

    // Readable only through reveal.
    const shown = await vault.call<{ apiKey: string }>('vault.show', { credentialId });
    expect(shown).toMatchObject({ ok: true, value: { apiKey } });
    expect(vault.infos.some((line) => line.includes('the support check'))).toBe(true);
    expect(vault.infos.join('\n')).not.toContain(apiKey);

    // The token verifies against the sealed verifier.
    expect(await vault.call('vault.check', { credentialId, token })).toMatchObject({
      ok: true,
      value: { valid: true },
    });
    expect(await vault.call('vault.check', { credentialId, token: `${token}x` })).toMatchObject({
      ok: true,
      value: { valid: false },
    });

    // Replacing the value destroys the former key in the same unit.
    expect(await vault.call('vault.replace', { credentialId, apiKey: replacement })).toMatchObject({
      ok: true,
    });
    const second = await vault.raw(async (view) => {
      const [row] = await view.rows();
      const events = await view.events(credentialId);
      const former = parseSealedValueText(created.values.apiKey ?? '');
      return {
        row,
        events,
        formerOpens: former === undefined ? 'unparsed' : await view.keys.openValue(former),
      };
    });
    const now = second.row?.apiKey as { keyId: string };
    expect(now.keyId).not.toBe(secret.keyId);
    expect(second.formerOpens).toBeUndefined();
    expect(dump(second.events)).not.toContain(replacement);
    const changed = second.events[1]?.data as { set: Record<string, string> };
    expect(changed.set.apiKey).toMatch(/^kwv1\./);
    // The chain rebuilds the current value: the update's before-image never carries the credential.
    expect(second.events[1]?.before ?? null).toBeNull();
    expect(await vault.call('vault.show', { credentialId })).toMatchObject({
      value: { apiKey: replacement },
    });
  });

  test('archiving the row destroys its credential keys', { timeout: 60_000 }, async () => {
    const vault = await bootVault(kind);
    const stored = await vault.call<{ credentialId: string }>('vault.store', {
      label: 'x',
      apiKey,
    });
    if (!stored.ok) throw new Error('store failed');
    const { credentialId } = stored.value;
    const sealed = await vault.raw(async (view) => {
      const events = await view.events(credentialId);
      const values = ((events[0]?.data ?? {}) as { values: Record<string, string> }).values;
      return {
        secret: parseSealedValueText(values.apiKey ?? ''),
        verifier: parseSealedValueText(values.tokenVerifier ?? ''),
      };
    });
    if (sealed.secret === undefined || sealed.verifier === undefined) throw new Error('unsealed');
    const { secret, verifier } = sealed;
    const live = await vault.raw(async (view) => [
      await view.keys.openValue(secret),
      await view.keys.openValue(verifier),
    ]);
    expect(live.map((plain) => plain !== undefined)).toEqual([true, true]);
    expect(await vault.call('vault.retire', { credentialId })).toMatchObject({ ok: true });
    const gone = await vault.raw(async (view) => [
      await view.keys.openValue(secret),
      await view.keys.openValue(verifier),
    ]);
    expect(gone).toEqual([undefined, undefined]);
  });

  test('a dry run that seals commits no scope key and no value key, and reports nothing in plaintext', {
    timeout: 60_000,
  }, async () => {
    const vault = await bootVault(kind);
    expect(await vault.hasScopeKey(vault.tenantId)).toBe(false);
    const report = await vault.explain({
      mode: 'dry-run',
      ref: 'vault.store',
      as: 'user:ada',
      input: { label: 'ci', apiKey },
    });
    expect(report.ok).toBe(true);
    expect(dump(report)).not.toContain(apiKey);
    expect(dump(report)).not.toContain('"kwv1.');
    expect(await vault.hasScopeKey(vault.tenantId)).toBe(false);
    expect(await vault.raw((view) => view.rows())).toHaveLength(0);
    // The real run creates the key the dry run only imagined.
    expect(await vault.call('vault.store', { label: 'ci', apiKey })).toMatchObject({ ok: true });
    expect(await vault.hasScopeKey(vault.tenantId)).toBe(true);
  });
});
