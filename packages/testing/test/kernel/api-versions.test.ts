import { readFileSync } from 'node:fs';
import type { PrincipalResolver, UserPrincipal } from '@keelwerk/core';
import {
  checkLedger,
  defineApiVersions,
  deriveSurface,
  parseApiVersionLedger,
  renderApiVersionLedger,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { libraryApp } from '../../src/fixtures/index.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { ada, app, boot, deploymentOf } from './support/runtime-kit.ts';

const ledgerFile = new URL(
  '../../src/fixtures/apps/library/generated/api-surface/library/ledger.json',
  import.meta.url,
);

describe('API versions on the fixture app', () => {
  test('the fixture declares its first version and the committed ledger agrees with its surface', () => {
    expect(app.api?.dates).toEqual(['2026-11-04']);
    const text = readFileSync(ledgerFile, 'utf8');
    const ledger = parseApiVersionLedger(text);
    expect(renderApiVersionLedger(ledger)).toBe(text);
    const { surface } = deriveSurface(libraryApp, '2026-11-04');
    const problems = checkLedger(ledger, 'library', [
      {
        version: '2026-11-04',
        surfaceHash: surface.hash,
        modules: Object.fromEntries(surface.modules.map((item) => [item.id, item.version])),
      },
    ]);
    expect(problems).toEqual([]);
  });
});

describe('resolveVersion in a running deployment', () => {
  async function opened(headers: Record<string, string>) {
    const runtime = await boot(deploymentOf('memory'));
    const backend = await runtime.control.createBackend({
      name: 'library',
      app: 'library',
      placement: 'main',
    });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'Acme NV' });
    const carrier = testCarrier({ name: 'acme', id: tenant.id }, ada);
    return runtime.invoker.open({
      ...carrier,
      headers: { ...carrier.headers, ...headers },
    });
  }

  test('a request without a version resolves the head, and the header names it too', async () => {
    expect(await opened({})).toMatchObject({ ok: true, value: { apiVersion: '2026-11-04' } });
    expect(await opened({ 'keelwerk-version': '2026-11-04' })).toMatchObject({
      ok: true,
      value: { apiVersion: '2026-11-04', deprecation: null },
    });
  });

  test('an unknown version is core.api_version_unknown, a malformed one core.api_version_invalid', async () => {
    expect(await opened({ 'keelwerk-version': '2030-01-01' })).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'core.api_version_unknown' },
    });
    expect(await opened({ 'keelwerk-version': 'next' })).toMatchObject({
      ok: false,
      error: { code: 'core.api_version_invalid' },
    });
  });

  test('a version below the floor is core.api_version_retired', async () => {
    expect(await opened({ 'keelwerk-version': '2020-01-01' })).toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'core.api_version_retired' },
    });
  });
});

describe('pins in a running deployment', () => {
  const older = '2026-11-04';
  const newer = '2026-11-05';
  const keyHeader = 'x-key-version';

  /** Resolves a user principal whose credential is pinned to the version in the header. */
  const keyed: PrincipalResolver = {
    id: 'test.keyed',
    describe: () => ({ scheme: 'apiKey', name: keyHeader }),
    *resolve(carrier, ctx) {
      const version = carrier.headers?.[keyHeader];
      if (version === undefined) return null;
      return {
        principal: {
          kind: 'user',
          subject: 'ada' as UserPrincipal['subject'],
          subjectRef: null,
          subjectAs: () => null,
          scope: {
            backend: ctx.scope.level === 'deployment' ? null : ctx.scope.backendId,
            tenant: ctx.scope.level === 'tenant' ? ctx.scope.tenantId : null,
          },
          claims: {},
          roles: [],
          memberships: [],
          via: 'test.keyed',
          ref: null,
          apiVersion: version,
        },
      };
    },
  };
  const twoVersions = {
    ...app,
    api: defineApiVersions({ [older]: {}, [newer]: {} }),
    registry: {
      ...app.registry,
      fills: new Map([
        ...app.registry.fills,
        [
          'core.principalResolvers',
          [
            { point: 'core.principalResolvers', module: 'core', bound: false, fill: keyed },
            ...(app.registry.fills.get('core.principalResolvers') ?? []),
          ],
        ],
      ]),
    },
  } as typeof app;

  async function versionOf(
    pins: { tenant?: string; backend?: string },
    headers: Record<string, string>,
  ): Promise<string | undefined> {
    const runtime = await boot(deploymentOf('memory', { apps: [twoVersions] }));
    const backend = await runtime.control.createBackend({
      name: 'library',
      app: 'library',
      placement: 'main',
      ...(pins.backend === undefined ? {} : { apiVersion: pins.backend }),
    });
    const tenant = await runtime.control.createTenant({
      backendId: backend.id,
      name: 'Acme NV',
      ...(pins.tenant === undefined ? {} : { apiVersion: pins.tenant }),
    });
    const carrier = testCarrier({ name: 'acme', id: tenant.id }, ada);
    const opened = await runtime.invoker.open({
      ...carrier,
      headers: { ...carrier.headers, ...headers },
    });
    return opened.ok ? opened.value.apiVersion : undefined;
  }

  test('without a pin the head answers; a tenant pin selects the older version', async () => {
    expect(await versionOf({}, {})).toBe(newer);
    expect(await versionOf({ tenant: older }, {})).toBe(older);
  });

  test('a backend pin applies to its tenants, and the tenant pin beats it', async () => {
    expect(await versionOf({ backend: older }, {})).toBe(older);
    expect(await versionOf({ backend: older, tenant: newer }, {})).toBe(newer);
  });

  test('the request header overrides the tenant pin', async () => {
    expect(await versionOf({ tenant: older }, { 'keelwerk-version': newer })).toBe(newer);
  });

  test('a credential pin beats the tenant pin, and the header beats the credential', async () => {
    expect(await versionOf({ tenant: newer }, { [keyHeader]: older })).toBe(older);
    expect(
      await versionOf({ tenant: older }, { [keyHeader]: older, 'keelwerk-version': newer }),
    ).toBe(newer);
  });
});
