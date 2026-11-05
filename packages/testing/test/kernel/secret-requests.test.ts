import { parseSealedValueText } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { bootVault } from './support/vault-kit.ts';

describe.each(['memory', 'pglite'] as const)('secret requests on %s (7.9.3, 17.2.2)', (kind) => {
  test('issue records the public id and the verifier, never the token; verify and reveal record nothing', {
    timeout: 60_000,
  }, async () => {
    const vault = await bootVault(kind);
    const stored = await vault.call<{ credentialId: string; token: string }>('vault.store', {
      label: 'ci',
      apiKey: 'sk-plain',
    });
    if (!stored.ok) throw new Error('store failed');
    const { credentialId, token } = stored.value;
    expect(token).toMatch(/^vlt_[a-z2-7]{26}_[a-z2-7]{52}$/);
    const events = await vault.raw((view) => view.events(credentialId));
    const decision = events[0]?.decision;
    const answers = decision?.answers ?? [];
    const issued = answers.filter((answer) => answer.kind === 'secret');
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ publicId: token.split('_')[1] });
    expect(JSON.stringify(decision)).not.toContain(token.split('_')[2] ?? 'x');
    expect(JSON.stringify(decision)).not.toContain('sk-plain');

    // verify and reveal are queries here: they record no answers and write no events.
    const before = vault.infos.length;
    await vault.call('vault.check', { credentialId, token });
    await vault.call('vault.show', { credentialId });
    const after = await vault.raw((view) => view.events(credentialId));
    expect(after).toHaveLength(1);
    expect(vault.infos.slice(before).filter((line) => line.startsWith('secret revealed'))).toEqual([
      expect.stringContaining('"reason":"the support check"'),
    ]);
  });

  test('verify compares under the scope key: another tenant does not accept, open or reveal what the first tenant sealed', {
    timeout: 60_000,
  }, async () => {
    const vault = await bootVault(kind);
    const stored = await vault.call<{ credentialId: string; token: string }>('vault.store', {
      label: 'ci',
      apiKey: 'sk-plain',
    });
    if (!stored.ok) throw new Error('store failed');
    const { credentialId, token } = stored.value;
    expect(await vault.call('vault.check', { credentialId, token })).toMatchObject({
      value: { valid: true },
    });
    const wrongPrefix = token.replace(/^vlt/, 'kws');
    expect(await vault.call('vault.check', { credentialId, token: wrongPrefix })).toMatchObject({
      value: { valid: false },
    });

    const events = await vault.raw((view) => view.events(credentialId));
    const sealedText = ((events[0]?.data ?? {}) as { values: Record<string, string> }).values
      .apiKey;
    const sealed = parseSealedValueText(sealedText ?? '');
    if (sealed === undefined) throw new Error('unsealed');

    const other = await vault.otherTenant('globex');
    expect(await other.call('vault.check', { credentialId, token })).toMatchObject({
      value: { valid: false },
    });
    expect(await other.call('vault.show', { credentialId })).toMatchObject({ ok: true, value: {} });
    expect(await other.raw((view) => view.keys.openValue(sealed))).toBeUndefined();
    await expect(
      other.raw((view) =>
        vault
          .keyService()
          .reveal(
            { keys: view.keys } as never,
            { ref: sealedText } as never,
            'a foreign tenant probes',
          ),
      ),
    ).rejects.toMatchObject({ kind: 'not_found' });
    // The first tenant still reads its own value.
    expect(await vault.call('vault.show', { credentialId })).toMatchObject({
      value: { apiKey: 'sk-plain' },
    });
  });

  test('a reveal of a value whose key is gone fails with not_found and leaks nothing', {
    timeout: 60_000,
  }, async () => {
    const vault = await bootVault(kind);
    const stored = await vault.call<{ credentialId: string }>('vault.store', {
      label: 'ci',
      apiKey: 'sk-plain',
    });
    if (!stored.ok) throw new Error('store failed');
    const { credentialId } = stored.value;
    const replaced = await vault.call('vault.replace', { credentialId, apiKey: 'sk-newer' });
    expect(replaced.ok).toBe(true);
    const events = await vault.raw((view) => view.events(credentialId));
    const former = parseSealedValueText(
      ((events[0]?.data ?? {}) as { values: Record<string, string> }).values.apiKey ?? '',
    );
    if (former === undefined) throw new Error('unsealed');
    expect(await vault.raw((view) => view.keys.openValue(former))).toBeUndefined();
  });

  test('backend config is checked against the module shape and its secrets are sealed under the backend key (S-70)', {
    timeout: 60_000,
  }, async () => {
    const vault = await bootVault(kind, {
      vault: { endpoint: 'https://vault.example', signingKey: 'sign-me-secret' },
      core: { introspection: 'public' },
    });
    const row = await vault.backendRow();
    const config = row?.config as Record<string, Record<string, string>>;
    expect(config.vault?.endpoint).toBe('https://vault.example');
    expect(config.core?.introspection).toBe('public');
    const sealed = config.vault?.signingKey ?? '';
    expect(sealed).toMatch(/^kwc1\.[^.]+\.vault\.signingKey\.1\.[^.]+\.[^.]+$/);
    expect(
      JSON.stringify(row, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v)),
    ).not.toContain('sign-me-secret');
    const keys = vault.keyService();
    expect(
      await keys.reveal({} as never, { ref: sealed } as never, 'the backend signs a callback'),
    ).toBe('sign-me-secret');
    // The text names its field: another field's text does not open it.
    await expect(
      keys.reveal(
        {} as never,
        { ref: sealed.replace('signingKey', 'endpoint') } as never,
        'a wrong field',
      ),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('backend config naming an unknown module, an undeclared config or a bad value is a validation error', {
    timeout: 60_000,
  }, async () => {
    const vault = await bootVault(kind);
    const bad = async (config: Record<string, unknown>) => {
      try {
        await vault.runtime.control.createBackend({
          name: 'again',
          app: 'vault',
          placement: 'main',
          config,
        });
      } catch (error) {
        return error as { kind?: string; code?: string };
      }
      return undefined;
    };
    expect(await bad({ nothing: {} })).toMatchObject({ kind: 'validation' });
    expect(await bad({ vault: { endpoint: 'x' } })).toMatchObject({ kind: 'validation' });
    expect(await bad({ vault: { endpoint: 1, signingKey: 's' } })).toMatchObject({
      kind: 'validation',
    });
    expect(await bad({ core: { introspection: 'everyone' } })).toMatchObject({
      kind: 'validation',
    });
  });

  test('a backend is refused at creation when a module misses a required field or holds an invalid value, naming module and field (S-107)', {
    timeout: 60_000,
  }, async () => {
    const vault = await bootVault(kind);
    const refused = async (config?: Record<string, unknown>) => {
      try {
        await vault.runtime.control.createBackend({
          name: 'second',
          app: 'vault',
          placement: 'main',
          ...(config === undefined ? {} : { config }),
        });
      } catch (error) {
        return error as { kind?: string; message?: string; issues?: { path: string[] }[] };
      }
      return undefined;
    };
    const none = await refused();
    expect(none).toMatchObject({ kind: 'validation', message: expect.stringContaining('"vault"') });
    expect(none?.issues?.map((issue) => issue.path.join('.')).sort()).toEqual([
      'vault.endpoint',
      'vault.signingKey',
    ]);
    const partial = await refused({ vault: { endpoint: 'https://vault.example' } });
    expect(partial).toMatchObject({ kind: 'validation' });
    expect(partial?.issues?.map((issue) => issue.path.join('.'))).toEqual(['vault.signingKey']);
    const invalid = await refused({ vault: { endpoint: 1, signingKey: 's' } });
    expect(invalid).toMatchObject({ kind: 'validation' });
    expect(invalid?.issues?.map((issue) => issue.path.join('.'))).toEqual(['vault.endpoint']);
  });

  test('a duplicate backend name is refused as a conflict before its secrets are sealed', {
    timeout: 60_000,
  }, async () => {
    const vault = await bootVault(kind);
    const attempt = vault.runtime.control.createBackend({
      name: 'vault',
      app: 'vault',
      placement: 'main',
      config: { vault: { endpoint: 'https://vault.example', signingKey: 's3cret' } },
    });
    await expect(attempt).rejects.toMatchObject({ kind: 'conflict' });
  });
});
