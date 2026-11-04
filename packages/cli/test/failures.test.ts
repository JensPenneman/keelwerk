import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiSurface } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { nodeHostFiles } from '../src/host/node-host-files.ts';
import { buildActionRoutes } from '../src/routes/build-action-routes.ts';
import type { FakeHandler } from './support/fake-host.ts';
import { createFakeHost } from './support/fake-host.ts';
import { json, portalServer } from './support/portal-server.ts';
import { portalSurface } from './support/portal-surface.ts';
import { profilesPath, remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

const unreachable = (): Response => {
  throw new TypeError('fetch failed');
};

test('an unreachable deployment while the surface loads ends with cli.unreachable (10), after three tries', async () => {
  const fake = createFakeHost({ files: remoteProfileFiles, handler: unreachable });
  const run = await runCliWith(['call', 'app.health'], fake.host);
  expect(run.code).toBe(10);
  expect(run.stderr).toContain('error[cli.unreachable]');
  expect(run.stderr).not.toContain('at ');
  expect(fake.sent).toHaveLength(3);
  expect(fake.sleeps).toEqual([200, 400]);
});

test('an interrupt while the surface loads ends with 130 and no retry', async () => {
  const controller = new AbortController();
  const fake = createFakeHost({
    files: remoteProfileFiles,
    handler: () => {
      controller.abort();
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    },
  });
  const run = await runCliWith(['call', 'app.health'], fake.host, controller.signal);
  expect(run.code).toBe(130);
  expect(fake.sent).toHaveLength(1);
});

test('the invoke names the API version of the surface its flags came from', async () => {
  const fake = createFakeHost({ files: remoteProfileFiles, handler: portalServer() });
  await runCliWith(['call', 'app.health'], fake.host);
  const invoke = fake.sent.find((sent) => sent.url.endsWith('/invoke'));
  expect(invoke?.request.headers['keelwerk-version']).toBe(portalSurface.apiVersion);
  const surface = fake.sent.find((sent) => sent.url.endsWith('/surface'));
  expect(surface?.request.headers).not.toHaveProperty('keelwerk-version');
});

test('--wait without a value is accepted; --wait-effects fails with core.live_unavailable (10)', async () => {
  const fake = createFakeHost({ files: remoteProfileFiles, handler: portalServer() });
  expect((await runCliWith(['call', 'app.health', '--wait'], fake.host)).code).toBe(0);
  expect((await runCliWith(['call', 'app.health', '--wait', '5'], fake.host)).code).toBe(0);
  const refused = await runCliWith(['call', 'app.health', '--wait-effects', '5'], fake.host);
  expect(refused.code).toBe(10);
  expect(refused.stderr).toContain('core.live_unavailable');
  expect(fake.sent.filter((sent) => sent.url.endsWith('/invoke'))).toHaveLength(2);
});

test('call list takes the connection and output flags', async () => {
  const fake = createFakeHost({ files: remoteProfileFiles, handler: portalServer() });
  const run = await runCliWith(
    ['call', 'list', '--profile', 'lvj', '--output', 'ndjson'],
    fake.host,
  );
  expect(run.code).toBe(0);
  expect(run.stdout.trim().split('\n').length).toBe(portalSurface.actions.length);
});

function withHints(
  ref: string,
  cli: { route?: string[]; aliases?: string[]; positional?: string[] },
): ApiSurface {
  return {
    ...portalSurface,
    actions: portalSurface.actions.map((action) =>
      action.ref === ref ? { ...action, hints: { ...action.hints, cli } } : action,
    ),
  };
}

test('an alias that equals a route name or the list route is skipped and reported, not fatal', () => {
  const skipped: string[] = [];
  const surface = withHints('app.health', { aliases: ['list', 'accounts.profile.create', 'ok'] });
  const routes = buildActionRoutes(surface, {
    onSkippedAlias: (alias) => {
      skipped.push(alias);
    },
  });
  expect(skipped).toEqual(['list', 'accounts.profile.create']);
  expect(routes.getAllEntries().map((entry) => entry.name.original)).toContain('app.health');
});

test('with a cli.route hint the reference still routes, and the hint is a second name', async () => {
  const surface = withHints('app.health', { route: ['status', 'now'] });
  const handler: FakeHandler = (sent) =>
    sent.url.endsWith('/surface') ? json(surface) : json({ ok: true, value: { ready: true } });
  const fake = createFakeHost({ files: remoteProfileFiles, handler });
  expect((await runCliWith(['call', 'app.health'], fake.host)).code).toBe(0);
  expect((await runCliWith(['call', 'status.now'], fake.host)).code).toBe(0);
});

test('--socket with a relative path is resolved against the working directory', async () => {
  const fake = createFakeHost({ handler: portalServer() });
  const run = await runCliWith(['call', 'app.health', '--socket', 'dev.sock'], fake.host);
  expect(run.code).toBe(0);
  expect(fake.sent[0]?.socketPath).toBe('/work/project/dev.sock');
});

test('a socket profile URL is percent-decoded to the socket path', async () => {
  const fake = createFakeHost({
    files: {
      [profilesPath]: JSON.stringify({
        current: 'sock',
        profiles: { sock: { url: 'unix:///run/my%20dir/op.sock' } },
      }),
    },
    handler: portalServer(),
  });
  await runCliWith(['call', 'app.health'], fake.host);
  expect(fake.sent[0]?.socketPath).toBe('/run/my dir/op.sock');
});

test('a refused profile in the file does not stop profile list or profile remove', async () => {
  const fake = createFakeHost({
    files: {
      [profilesPath]: JSON.stringify({
        profiles: { bad: { url: 'http://lvj.example' }, ok: { url: 'https://lvj.example' } },
      }),
    },
  });
  expect((await runCliWith(['profile', 'list'], fake.host)).code).toBe(0);
  expect((await runCliWith(['profile', 'remove', 'bad'], fake.host)).code).toBe(0);
  const left = JSON.parse(fake.files.get(profilesPath)?.text ?? '{}') as { profiles: object };
  expect(Object.keys(left.profiles)).toEqual(['ok']);
  const used = await runCliWith(['call', 'app.health', '--profile', 'ok'], fake.host);
  expect(used.code).not.toBe(2);
});

test('a missing secret with a terminal on stdout but not on stdin is a usage error naming the flag', async () => {
  const fake = createFakeHost({
    files: remoteProfileFiles,
    handler: portalServer(),
    interactive: true,
    stdinInteractive: false,
    secret: 'never-asked',
  });
  const run = await runCliWith(['call', 'accounts.profile.create', '--name', 'A'], fake.host);
  expect(run.code).toBe(2);
  expect(run.stderr).toContain('--password-stdin');
  expect(fake.sent.filter((sent) => sent.url.endsWith('/invoke'))).toEqual([]);
});

test('a missing secret is prompted for when stdin is a terminal', async () => {
  const fake = createFakeHost({
    files: remoteProfileFiles,
    handler: portalServer(),
    interactive: true,
    secret: 'typed',
  });
  const run = await runCliWith(['call', 'accounts.profile.create', '--name', 'A'], fake.host);
  expect(run.code).toBe(0);
  const invoke = fake.sent.find((sent) => sent.url.endsWith('/invoke'));
  expect(JSON.parse(invoke?.request.body ?? '{}').input.password).toBe('typed');
});

test('writing a file replaces it whole and leaves no temporary file behind', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'keelwerk-cli-'));
  try {
    const path = join(directory, 'credentials.json');
    await nodeHostFiles.writeText(path, 'one', 0o600);
    await nodeHostFiles.writeText(path, 'two', 0o600);
    expect(await readdir(directory)).toEqual(['credentials.json']);
    expect(await nodeHostFiles.readText(path)).toBe('two');
  } finally {
    await rm(directory, { recursive: true });
  }
});
