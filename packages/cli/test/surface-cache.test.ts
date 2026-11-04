import { expect, test } from 'vitest';
import { createFakeHost } from './support/fake-host.ts';
import { portalServer } from './support/portal-server.ts';
import { portalSurface } from './support/portal-surface.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

const xdgCacheHomeVariable = 'XDG_CACHE_HOME';

test('the surface is cached by hash and revalidated with If-None-Match on every run', async () => {
  const fake = createFakeHost({
    files: remoteProfileFiles,
    env: { [xdgCacheHomeVariable]: '/cache' },
    handler: portalServer(),
  });
  await runCliWith(['call', 'list'], fake.host);
  expect(fake.sent[0]?.request.headers['if-none-match']).toBeUndefined();
  const cached = [...fake.files.keys()].filter((path) =>
    path.startsWith('/cache/keelwerk/surfaces/'),
  );
  expect(cached).toContain('/cache/keelwerk/surfaces/sha256-portalFixture.json');
  expect(cached).toContain('/cache/keelwerk/surfaces/index.json');
  expect(fake.files.get('/cache/keelwerk/surfaces/sha256-portalFixture.json')?.mode).toBe(0o600);

  const second = await runCliWith(['call', 'list'], fake.host);
  const surfaceRequests = fake.sent.filter((sent) => sent.url.endsWith('/surface'));
  expect(surfaceRequests).toHaveLength(2);
  expect(surfaceRequests[1]?.request.headers['if-none-match']).toBe(`"${portalSurface.hash}"`);
  expect(JSON.parse(second.stdout)).toHaveLength(portalSurface.actions.length);
});

test('requests carry the credential, the selectors and the client name, and no Origin', async () => {
  const fake = createFakeHost({ files: remoteProfileFiles, handler: portalServer() });
  await runCliWith(['call', 'app.health', '--tenant', 'acme'], fake.host);
  const headers = fake.sent.at(-1)?.request.headers ?? {};
  expect(fake.sent.at(-1)?.url).toBe('https://lvj.example/_keelwerk/v1/invoke');
  expect(headers.authorization).toBe('Bearer secret-token');
  expect(headers['x-keelwerk-backend']).toBe('launchway');
  expect(headers['x-keelwerk-tenant']).toBe('acme');
  expect(headers['keelwerk-client']).toMatch(/^keelwerk-cli\/\d+\.\d+\.\d+$/);
  expect(headers).not.toHaveProperty('origin');
});

test('--socket goes over the operator socket', async () => {
  const fake = createFakeHost({ handler: portalServer() });
  await runCliWith(['call', 'app.health', '--socket', '/run/keelwerk/operator.sock'], fake.host);
  expect(fake.sent.every((sent) => sent.socketPath === '/run/keelwerk/operator.sock')).toBe(true);
  expect(fake.sent.at(-1)?.url).toBe('/_keelwerk/v1/invoke');
});
