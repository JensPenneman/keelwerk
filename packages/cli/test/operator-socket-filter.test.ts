import { renderTypeId } from '@keelwerk/core';
import { libraryApp } from '@keelwerk/testing/fixtures';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createFakeHost } from './support/fake-host.ts';
import { type FixtureDeployment, startFixtureDeployment } from './support/fixture-deployment.ts';
import { runCliWith } from './support/run-cli-with.ts';

let fixture: FixtureDeployment;

beforeAll(async () => {
  fixture = await startFixtureDeployment({ app: libraryApp, host: httpHost() });
});

afterAll(async () => {
  await fixture.stop();
});

const hostFor = () => {
  const fake = createFakeHost({ handler: fixture.handler, files: {}, stdin: '' });
  return { ...fake, host: { ...fake.host, newId: () => crypto.randomUUID() } };
};

describe('a filter over the operator socket', () => {
  test("call core.tenant.query filters by a backend's public id over the socket and refuses its bare uuid", async () => {
    const backend = await fixture.runtime.control.createBackend({
      name: 'filtered',
      app: 'library',
      placement: 'main',
    });
    await fixture.runtime.control.createTenant({ backendId: backend.id, name: 'filtered-tenant' });
    const call = (backendId: string) =>
      runCliWith(
        [
          'call',
          'core.tenant.query',
          '--input',
          JSON.stringify({ filter: { backendId } }),
          '--socket',
          fixture.socket,
          '--output',
          'json',
        ],
        hostFor().host,
      );
    const listed = await call(renderTypeId('bknd', backend.id));
    expect(listed.stderr).toBe('');
    expect(listed.code).toBe(0);
    expect(JSON.parse(listed.stdout)).toMatchObject({ items: [{ name: 'filtered-tenant' }] });
    expect((await call(backend.id)).code).toBe(3);
  });
});
