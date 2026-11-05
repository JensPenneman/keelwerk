import { libraryApp } from '@keelwerk/testing/fixtures';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createFakeHost } from './support/fake-host.ts';
import {
  type FixtureDeployment,
  operatorHost,
  startFixtureDeployment,
} from './support/fixture-deployment.ts';
import { credentialsPath, profilesPath } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

let fixture: FixtureDeployment;
const tenantHost = 'acme.example.test';

beforeAll(async () => {
  fixture = await startFixtureDeployment({ app: libraryApp, host: httpHost() });
});

afterAll(async () => {
  await fixture.stop();
});

const tenantFiles = {
  [profilesPath]: JSON.stringify({
    current: 'acme',
    profiles: { acme: { url: `https://${tenantHost}` } },
  }),
};

/** A host whose command ids are unique across hosts, as real ones are. */
const withFiles = (files: Readonly<Record<string, string>>) => {
  const fake = createFakeHost({ files, handler: fixture.handler });
  return { ...fake, host: { ...fake.host, newId: () => crypto.randomUUID() } };
};

describe('a running deployment gains a backend and a tenant without a restart', () => {
  test('before the tenant exists its host name resolves to nothing', async () => {
    const run = await runCliWith(['introspect', 'modules'], withFiles(tenantFiles).host);
    expect(run.code).toBe(6);
  });

  test('once the control path made them, the same CLI lists them with a called action and introspects the tenant', async () => {
    const issued = await runCliWith(
      [
        'operator',
        'token',
        'issue',
        '--label',
        'live',
        '--socket',
        fixture.socket,
        '--output',
        'json',
      ],
      withFiles({}).host,
    );
    const { token } = JSON.parse(issued.stdout) as { token: string };
    const backend = await runCliWith(
      [
        'backend',
        'create',
        'library',
        '--app',
        'library',
        '--placement',
        'main',
        '--socket',
        fixture.socket,
        '--output',
        'json',
      ],
      withFiles({}).host,
    );
    expect(backend.stderr).toBe('');
    expect(backend.code).toBe(0);
    const tenant = await runCliWith(
      [
        'tenant',
        'create',
        'acme',
        '--backend',
        'library',
        '--domain',
        tenantHost,
        '--socket',
        fixture.socket,
        '--output',
        'json',
      ],
      withFiles({}).host,
    );
    expect(tenant.stderr).toBe('');
    expect(tenant.code).toBe(0);
    const ops = withFiles({
      [profilesPath]: JSON.stringify({
        current: 'ops',
        profiles: { ops: { url: `https://${operatorHost}` } },
      }),
      [credentialsPath]: JSON.stringify({ credentials: { ops: { token } } }),
    });
    const called = await runCliWith(['call', 'core.tenant.query', '--output', 'json'], ops.host);
    expect(called.stderr).toBe('');
    expect(called.code).toBe(0);
    expect(JSON.parse(called.stdout)).toMatchObject({
      items: [{ name: 'acme', domains: [tenantHost] }],
    });

    const fake = withFiles(tenantFiles);
    const me = await runCliWith(['call', 'core.me', '--output', 'json'], fake.host);
    expect(me.stderr).toBe('');
    expect(me.code).toBe(0);
    expect(JSON.parse(me.stdout)).toMatchObject({ principal: { kind: 'anonymous' } });
    const modules = await runCliWith(['introspect', 'modules', '--output', 'json'], fake.host);
    expect(modules.code).toBe(0);
    expect(JSON.parse(modules.stdout)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'library' })]),
    );
    const entity = await runCliWith(
      ['introspect', 'entity', 'library.book', '--output', 'json'],
      fake.host,
    );
    expect(entity.code).toBe(0);
    expect(JSON.parse(entity.stdout)).toMatchObject({ ref: 'library.book', prefix: 'book' });
    const missing = await runCliWith(['introspect', 'entity', 'no.such'], fake.host);
    expect(missing.code).toBe(2);
    const actions = await runCliWith(['introspect', 'actions', '--output', 'json'], fake.host);
    expect(JSON.parse(actions.stdout)).toEqual(
      expect.arrayContaining([expect.objectContaining({ ref: 'core.me', auth: 'public' })]),
    );
    const tree = await runCliWith(['introspect', '--output', 'text'], fake.host);
    expect(tree.stdout).toContain('library');
  });
});
