import { describe, expect, test } from 'vitest';
import { byHeader } from './by-header.ts';
import { byHostname } from './by-hostname.ts';
import { byPath } from './by-path.ts';
import { byScopeKey } from './by-scope-key.ts';
import { env } from './env.ts';
import { secret } from './secret.ts';

describe('tenant resolvers (S-20)', () => {
  test('each entry names its kind', () => {
    expect(byHostname()).toEqual({ kind: 'hostname' });
    expect(byHeader('x-keelwerk-tenant')).toEqual({ kind: 'header', header: 'x-keelwerk-tenant' });
    expect(byHeader('x-tenant', { backendHeader: 'x-backend' })).toEqual({
      kind: 'header',
      header: 'x-tenant',
      backendHeader: 'x-backend',
    });
    expect(byScopeKey()).toEqual({ kind: 'scopeKey' });
    expect(byPath()).toEqual({ kind: 'path' });
  });
});

describe('deployment values', () => {
  test('env names an environment variable; secret names a secret reference', () => {
    expect(env('KEELWERK_DATA_URL')).toEqual({ kind: 'env', name: 'KEELWERK_DATA_URL' });
    expect(secret('KEELWERK_MASTER_KEY')).toEqual({ ref: 'KEELWERK_MASTER_KEY' });
  });
});
