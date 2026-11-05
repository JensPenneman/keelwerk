import { commandReceiptUuid, renderTypeId } from '@keelwerk/core';
import { libraryApp } from '@keelwerk/testing/fixtures';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createFakeHost, type FakeHost } from './support/fake-host.ts';
import {
  type FixtureDeployment,
  operatorHost,
  startFixtureDeployment,
} from './support/fixture-deployment.ts';
import { credentialsPath, profilesPath } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

let fixture: FixtureDeployment;

beforeAll(async () => {
  fixture = await startFixtureDeployment({ app: libraryApp, host: httpHost() });
});

afterAll(async () => {
  await fixture.stop();
});

/** A host whose command ids are unique across hosts, as real ones are. */
const uniquely = (fake: FakeHost): FakeHost => ({
  ...fake,
  host: { ...fake.host, newId: () => crypto.randomUUID() },
});

const hostFor = (files: Readonly<Record<string, string>> = {}, stdin = '') =>
  uniquely(createFakeHost({ handler: fixture.handler, files, stdin }));

describe('the operator socket', () => {
  test('a deployment-scope receipt read is accepted over the socket, as --wait needs', async () => {
    const run = await runCliWith(
      [
        'call',
        'core.commandReceipt.get',
        '--input',
        JSON.stringify({ ids: [renderTypeId('rcpt', commandReceiptUuid('deployment', 'none'))] }),
        '--socket',
        fixture.socket,
        '--output',
        'json',
      ],
      hostFor().host,
    );
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ list: [], notFound: [expect.any(String)] });
  });

  test('backend list and tenant list read the control store through the socket', async () => {
    const backend = await fixture.runtime.control.createBackend({
      name: 'library',
      app: 'library',
      placement: 'main',
    });
    await fixture.runtime.control.createTenant({
      backendId: backend.id,
      name: 'acme',
      domains: ['acme.example.test'],
    });
    const backends = await runCliWith(
      ['backend', 'list', '--socket', fixture.socket, '--output', 'json'],
      hostFor().host,
    );
    expect(backends.code).toBe(0);
    expect(JSON.parse(backends.stdout)).toMatchObject([
      { name: 'library', app: 'library', placement: 'main', status: 'active' },
    ]);
    const tenants = await runCliWith(
      ['tenant', 'list', '--backend', 'library', '--socket', fixture.socket, '--output', 'json'],
      hostFor().host,
    );
    expect(tenants.code).toBe(0);
    expect(JSON.parse(tenants.stdout)).toMatchObject([
      { name: 'acme', domains: 'acme.example.test', status: 'active' },
    ]);
    const unknown = await runCliWith(
      ['tenant', 'list', '--backend', 'nope', '--socket', fixture.socket],
      hostFor().host,
    );
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('No backend is named "nope"');
  });

  test('backend create and tenant create through the socket make the rows, and one command id gives one id', async () => {
    const created = async (args: readonly string[]) => {
      const run = await runCliWith(
        [...args, '--socket', fixture.socket, '--output', 'json'],
        hostFor().host,
      );
      expect(run.stderr).toBe('');
      expect(run.code).toBe(0);
      return (JSON.parse(run.stdout) as { id: string }).id;
    };
    const backend = ['backend', 'create', 'second', '--app', 'library', '--placement', 'main'];
    const first = await created([...backend, '--command-id', crypto.randomUUID()]);
    expect(first).toMatch(/^bknd_/);
    const commandId = crypto.randomUUID();
    const tenant = [
      'tenant',
      'create',
      'beta',
      '--backend',
      'second',
      '--domain',
      'beta.example.test',
    ];
    const one = await created([...tenant, '--command-id', commandId]);
    expect(one).toMatch(/^tnt_/);
    expect(await created([...tenant, '--command-id', commandId])).toBe(one);
    const tenants = await runCliWith(
      ['tenant', 'list', '--backend', 'second', '--socket', fixture.socket, '--output', 'json'],
      hostFor().host,
    );
    expect(JSON.parse(tenants.stdout)).toHaveLength(1);
    const clash = await runCliWith([...backend, '--socket', fixture.socket], hostFor().host);
    expect(clash.code).not.toBe(0);
  });

  test('a token issued over the socket works in a remote profile at the operator host', async () => {
    const issued = await runCliWith(
      [
        'operator',
        'token',
        'issue',
        '--label',
        'e2e',
        '--socket',
        fixture.socket,
        '--output',
        'json',
      ],
      hostFor().host,
    );
    expect(issued.stderr).toBe('');
    expect(issued.code).toBe(0);
    const { token } = JSON.parse(issued.stdout) as { token: string };
    expect(token).toMatch(/^kwo_/);

    const files = {
      [profilesPath]: JSON.stringify({
        current: 'ops',
        profiles: { ops: { url: `https://${operatorHost}` } },
      }),
    };
    const stored = uniquely(
      createFakeHost({ handler: fixture.handler, files, stdin: `${token}\n` }),
    );
    const added = await runCliWith(
      ['profile', 'add', 'ops', `https://${operatorHost}`, '--token-stdin'],
      stored.host,
    );
    expect(added.code).toBe(0);
    expect(JSON.parse(stored.files.get(credentialsPath)?.text ?? '{}')).toEqual({
      credentials: { ops: { token } },
    });
    expect(stored.files.get(credentialsPath)?.mode).toBe(0o600);

    const listed = await runCliWith(
      ['operator', 'token', 'list', '--profile', 'ops', '--output', 'json'],
      uniquely(
        createFakeHost({
          handler: fixture.handler,
          files: { ...files, [credentialsPath]: stored.files.get(credentialsPath)?.text ?? '' },
        }),
      ).host,
    );
    expect(listed.code).toBe(0);
    expect(JSON.parse(listed.stdout)).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'e2e' })]),
    );
    expect(listed.stdout).not.toContain(token);
  });

  test('without a token the operator host is no tenant and answers not found', async () => {
    const run = await runCliWith(
      ['operator', 'token', 'list', '--profile', 'ops'],
      hostFor({
        [profilesPath]: JSON.stringify({
          current: 'ops',
          profiles: { ops: { url: `https://${operatorHost}` } },
        }),
      }).host,
    );
    expect(run.code).toBe(6);
  });
  test('a tenant is worked in only after tenant enter: --tenant is refused before it, served after, not found when unknown', async () => {
    const backend = await fixture.runtime.control.createBackend({
      name: 'entered',
      app: 'library',
      placement: 'main',
    });
    const created = await fixture.runtime.control.createTenant({
      backendId: backend.id,
      name: 'gamma',
    });
    const tenant = renderTypeId('tnt', created.id);
    const query = (...extra: string[]) =>
      runCliWith(
        ['call', 'library.book.query', ...extra, '--socket', fixture.socket, '--output', 'json'],
        hostFor().host,
      );
    expect((await query('--tenant', tenant)).code).toBe(5);
    expect((await query()).code).toBe(5);

    const entered = await runCliWith(
      [
        'tenant',
        'enter',
        'gamma',
        '--backend',
        'entered',
        '--reason',
        'support',
        '--socket',
        fixture.socket,
        '--output',
        'json',
      ],
      hostFor().host,
    );
    expect(entered.stderr).toBe('');
    expect(entered.code).toBe(0);
    const after = await query('--tenant', tenant);
    expect(after.stderr).toBe('');
    expect(after.code).toBe(0);
    expect(JSON.parse(after.stdout)).toMatchObject({ items: [] });
    expect((await query()).code).toBe(5);
    expect((await query('--tenant', renderTypeId('tnt', crypto.randomUUID()))).code).toBe(6);

    const refused = await runCliWith(
      ['tenant', 'list', '--tenant', tenant, '--socket', fixture.socket],
      hostFor().host,
    );
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('--tenant');
  });

  test('call --tenant <id> --backend <name> sends the backend id: the right name is served, a wrong or unknown name is refused', async () => {
    const backend = await fixture.runtime.control.createBackend({
      name: 'named',
      app: 'library',
      placement: 'main',
    });
    await fixture.runtime.control.createBackend({
      name: 'other-named',
      app: 'library',
      placement: 'main',
    });
    const created = await fixture.runtime.control.createTenant({
      backendId: backend.id,
      name: 'delta',
    });
    const tenant = renderTypeId('tnt', created.id);
    const entered = await runCliWith(
      [
        'tenant',
        'enter',
        tenant,
        '--reason',
        'support',
        '--socket',
        fixture.socket,
        '--output',
        'json',
      ],
      hostFor().host,
    );
    expect(entered.code).toBe(0);
    const query = (backendFlag: string) =>
      runCliWith(
        [
          'call',
          'library.book.query',
          '--tenant',
          tenant,
          '--backend',
          backendFlag,
          '--socket',
          fixture.socket,
          '--output',
          'json',
        ],
        hostFor().host,
      );
    const byName = await query('named');
    expect(byName.stderr).toBe('');
    expect(byName.code).toBe(0);
    expect(JSON.parse(byName.stdout)).toMatchObject({ items: [] });
    expect((await query(renderTypeId('bknd', backend.id))).code).toBe(0);
    expect((await query('other-named')).code).toBe(6);
    const unknown = await query('no-such-backend');
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('no-such-backend');
  });
});
