import { describe, expect, test } from 'vitest';
import { staticScopeDirectory } from '../../../test/invoker/static-scope-directory.ts';
import { renderTypeId } from '../../ids/render-type-id.ts';
import type { NamespaceRef } from '../../storage/namespace-ref.ts';
import { applyTenantResolvers } from './apply-tenant-resolvers.ts';
import { tenantPathOf } from './tenant-path-of.ts';

const uuid = (n: number): string => `00000000-0000-7000-8000-00000000000${n}`;
const [id1, id2, id3] = [uuid(1), uuid(2), uuid(3)];
const namespace: NamespaceRef = {
  id: 'ns-1',
  placementId: 'main',
  appId: 'doc',
  tenantId: null,
  root: 'doc',
};
const backend = (id: string) => ({
  id,
  app: 'doc',
  placementId: 'main',
  namespace,
  status: 'active' as const,
});
const tenant = (id: string, backendId: string) => ({
  id,
  backendId,
  placementId: 'main',
  namespace,
  status: 'active' as const,
});
const directory = staticScopeDirectory({
  backends: [backend('b1'), backend('b2')],
  tenants: [tenant(id1, 'b1'), tenant(id2, 'b1'), tenant(id3, 'b2')],
  domains: [
    { hostname: 'one.example', backendId: 'b1', tenantId: id1 },
    { hostname: 'shared.example', backendId: 'b1', tenantId: null },
  ],
});
const tnt = (id: string): string => renderTypeId('tnt', id);
const hostname = { kind: 'hostname' } as const;
const path = { kind: 'path' } as const;
const header = { kind: 'header', header: 'x-tenant' } as const;
const at = (host: string, requestPath: string, headers?: Record<string, string>) => ({
  transport: 'test',
  host,
  path: requestPath,
  ...(headers === undefined ? {} : { headers }),
});

describe('tenantPathOf', () => {
  test('tenantPathOf reads /t/<segment> at the start of the path and nothing else', () => {
    expect(tenantPathOf('/t/abc/x')).toEqual({ prefix: '/t/abc', segment: 'abc' });
    expect(tenantPathOf('/t/abc')).toEqual({ prefix: '/t/abc', segment: 'abc' });
    expect(tenantPathOf('/t')).toBeUndefined();
    expect(tenantPathOf('/tx/a')).toBeUndefined();
    expect(tenantPathOf('/api/t/a')).toBeUndefined();
    expect(tenantPathOf('/t//x')).toEqual({ prefix: '/t/', segment: '' });
  });
});

describe('applyTenantResolvers with a path', () => {
  test('without a path resolver a tenant path is ignored', async () => {
    const found = await applyTenantResolvers(
      [hostname],
      at('one.example', `/t/${tnt(id2)}/x`),
      directory,
    );
    expect(found?.tenant?.id).toBe(id1);
    expect(found?.resolvedBy).toBe('hostname');
    expect(found?.tenantPrefix).toBeUndefined();
  });

  test('a path names its tenant by TypeID only and reports the prefix as sent', async () => {
    const typed = tnt(id3);
    const found = await applyTenantResolvers([path], at('x.example', `/t/${typed}/a`), directory);
    expect(found).toMatchObject({ resolvedBy: 'path', tenantPrefix: `/t/${typed}` });
    expect(found?.tenant?.id).toBe(id3);
    const bare = await applyTenantResolvers([path], at('x.example', `/t/${typed}`), directory);
    expect(bare).toMatchObject({ resolvedBy: 'path', tenantPrefix: `/t/${typed}` });
  });

  test('the stored uuid or another spelling of a known tenant in the path names nothing', async () => {
    const typed = tnt(id2);
    const suffix = typed.slice('tnt_'.length);
    const spellings = [
      id2,
      typed.toUpperCase(),
      `tnt_${suffix.toUpperCase()}`,
      `TNT_${suffix}`,
      `tnt%5F${suffix}`,
      `tnt_${suffix}x`,
    ];
    for (const segment of spellings) {
      for (const host of ['x.example', 'shared.example']) {
        const carrier = at(host, `/t/${segment}/x`);
        expect(await applyTenantResolvers([path], carrier, directory)).toBeUndefined();
        expect(await applyTenantResolvers([hostname, path], carrier, directory)).toBeUndefined();
      }
    }
    const own = at('one.example', `/t/${id1}/x`);
    expect(await applyTenantResolvers([hostname, path], own, directory)).toBeUndefined();
  });

  test('a path tenant on its own host name or on a backend host name of its backend resolves by path', async () => {
    const own = await applyTenantResolvers(
      [hostname, path],
      at('one.example', `/t/${tnt(id1)}/x`),
      directory,
    );
    expect(own?.resolvedBy).toBe('path');
    expect(own?.tenant?.id).toBe(id1);
    const shared = await applyTenantResolvers(
      [hostname, path],
      at('shared.example', `/t/${tnt(id2)}/x`),
      directory,
    );
    expect(shared?.resolvedBy).toBe('path');
    expect(shared?.tenant?.id).toBe(id2);
  });

  test('a path that names another tenant than the host name is refused, in either deployment order', async () => {
    const carrier = at('one.example', `/t/${tnt(id2)}/x`);
    expect(await applyTenantResolvers([hostname, path], carrier, directory)).toBeUndefined();
    expect(await applyTenantResolvers([path, hostname], carrier, directory)).toBeUndefined();
  });

  test('a path that names another tenant than the header, or a tenant of another backend, is refused', async () => {
    const other = at('x.example', `/t/${tnt(id2)}/x`, { 'x-tenant': id1 });
    expect(await applyTenantResolvers([header, path], other, directory)).toBeUndefined();
    const foreign = at('shared.example', `/t/${tnt(id3)}/x`);
    expect(await applyTenantResolvers([hostname, path], foreign, directory)).toBeUndefined();
  });

  test('an unknown, empty or malformed path tenant is refused whatever the other resolvers match', async () => {
    for (const segment of [tnt(uuid(9)), '', 'tnt_bad', 'doc_xyz']) {
      const carrier = at('one.example', `/t/${segment}/x`);
      expect(await applyTenantResolvers([hostname, path], carrier, directory)).toBeUndefined();
    }
  });
});
