import { describe, expect, test } from 'vitest';
import { findDeploymentFile } from '../src/context/find-deployment-file.ts';
import { profileUrlProblem } from '../src/context/profile-url-problem.ts';
import { resolveProfile } from '../src/context/resolve-profile.ts';
import { scanGlobalOptions } from '../src/context/scan-global-options.ts';
import { createFakeHost } from './support/fake-host.ts';
import { credentialsPath, profilesPath, remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

const keelwerkConfigVariable = 'KEELWERK_CONFIG';

const keelwerkProfileVariable = 'KEELWERK_PROFILE';

const keelwerkTokenVariable = 'KEELWERK_TOKEN';

describe('profile URLs (S-42)', () => {
  test.each([
    'https://lvj.example',
    'unix:///run/keelwerk/operator.sock',
    'http://localhost:3000',
    'http://127.0.0.1:8080',
    'http://127.4.5.6',
    'http://[::1]:8080',
  ])('%s is accepted', (url) => {
    expect(profileUrlProblem(url)).toBeUndefined();
  });

  test.each([
    'http://lvj.example',
    'http://10.0.0.5',
    'http://128.0.0.1',
    'ftp://lvj.example',
    'unix://',
    'not a url',
  ])('%s is refused', (url) => {
    expect(profileUrlProblem(url)).toBeTypeOf('string');
  });
});

describe('profile and credential files', () => {
  test('profile add writes both files with mode 0600 and makes the first profile current', async () => {
    const fake = createFakeHost({ stdin: 'tok-123\n' });
    const run = await runCliWith(
      ['profile', 'add', 'lvj', 'https://lvj.example', '--backend', 'launchway', '--token-stdin'],
      fake.host,
    );
    expect(run.code).toBe(0);
    expect(fake.files.get(profilesPath)?.mode).toBe(0o600);
    expect(fake.files.get(credentialsPath)?.mode).toBe(0o600);
    expect(JSON.parse(fake.files.get(profilesPath)?.text ?? '')).toEqual({
      current: 'lvj',
      profiles: { lvj: { url: 'https://lvj.example', backend: 'launchway' } },
    });
    expect(JSON.parse(fake.files.get(credentialsPath)?.text ?? '')).toEqual({
      credentials: { lvj: { token: 'tok-123' } },
    });
  });

  test('profile add refuses http:// to a non-loopback host (exit 2) and writes nothing', async () => {
    const fake = createFakeHost();
    const run = await runCliWith(['profile', 'add', 'x', 'http://lvj.example'], fake.host);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('loopback');
    expect(fake.files.size).toBe(0);
  });

  test('use, list, show and remove', async () => {
    const fake = createFakeHost({ files: remoteProfileFiles });
    expect((await runCliWith(['profile', 'use', 'lvj-operator'], fake.host)).code).toBe(0);
    expect(JSON.parse(fake.files.get(profilesPath)?.text ?? '').current).toBe('lvj-operator');
    expect(fake.files.get(profilesPath)?.mode).toBe(0o600);
    const list = await runCliWith(['profile', 'list'], fake.host);
    expect(JSON.parse(list.stdout)).toHaveLength(2);
    const show = await runCliWith(['profile', 'show', 'lvj'], fake.host);
    expect(JSON.parse(show.stdout)).toMatchObject({ name: 'lvj', credential: 'stored' });
    expect(show.stdout).not.toContain('secret-token');
    expect((await runCliWith(['profile', 'remove', 'lvj'], fake.host)).code).toBe(0);
    expect(JSON.parse(fake.files.get(profilesPath)?.text ?? '').profiles.lvj).toBeUndefined();
    expect(fake.files.get(credentialsPath)?.mode).toBe(0o600);
    expect(JSON.parse(fake.files.get(credentialsPath)?.text ?? '').credentials).toEqual({});
    expect((await runCliWith(['profile', 'use', 'ghost'], fake.host)).code).toBe(2);
  });

  test('a profile file with a refused URL is a usage error when it is used', async () => {
    const fake = createFakeHost({
      files: {
        [profilesPath]: JSON.stringify({
          current: 'bad',
          profiles: { bad: { url: 'http://example.com' } },
        }),
      },
    });
    const run = await runCliWith(['call', 'app.health'], fake.host);
    expect(run.code).toBe(2);
  });
});

describe('resolveProfile', () => {
  const host = (env: Record<string, string> = {}) =>
    createFakeHost({ files: remoteProfileFiles, env }).host;

  test('the current profile, with its credential and selectors', async () => {
    expect(await resolveProfile(host(), {})).toEqual({
      kind: 'remote',
      name: 'lvj',
      url: 'https://lvj.example',
      backend: 'launchway',
      tenant: 'jens',
      token: 'secret-token',
    });
  });

  test('flags beat the profile; KEELWERK_PROFILE beats the file; KEELWERK_TOKEN beats the credential', async () => {
    const resolved = await resolveProfile(host({ [keelwerkTokenVariable]: 'ci-token' }), {
      tenant: 'acme',
    });
    expect(resolved).toMatchObject({ tenant: 'acme', backend: 'launchway', token: 'ci-token' });
    const operator = await resolveProfile(host({ [keelwerkProfileVariable]: 'lvj-operator' }), {});
    expect(operator).toMatchObject({ kind: 'socket', socketPath: '/run/keelwerk/operator.sock' });
    expect(operator.token).toBeUndefined();
  });

  test('--socket needs no profile file', async () => {
    const resolved = await resolveProfile(createFakeHost().host, { socket: '/tmp/s.sock' });
    expect(resolved).toEqual({
      kind: 'socket',
      url: 'unix:///tmp/s.sock',
      socketPath: '/tmp/s.sock',
    });
  });

  test('no profile and no project is "none"', async () => {
    expect((await resolveProfile(createFakeHost().host, {})).kind).toBe('none');
  });
});

describe('findDeploymentFile (section 16.9.1)', () => {
  const at = (cwd: string, paths: string[], env: Record<string, string> = {}) =>
    createFakeHost({ cwd, env, files: Object.fromEntries(paths.map((path) => [path, ''])) }).host;

  test('--config, then KEELWERK_CONFIG, then keelwerk.config.ts in an ancestor, then .launchway/deployment.ts', async () => {
    const files = ['/work/keelwerk.config.ts', '/work/.launchway/deployment.ts'];
    expect(await findDeploymentFile(at('/work/a/b', files), 'x/y.ts')).toBe('/work/a/b/x/y.ts');
    expect(
      await findDeploymentFile(at('/work/a/b', files, { [keelwerkConfigVariable]: '/etc/k.ts' })),
    ).toBe('/etc/k.ts');
    expect(await findDeploymentFile(at('/work/a/b', files))).toBe('/work/keelwerk.config.ts');
    expect(await findDeploymentFile(at('/work/a/b', ['/work/.launchway/deployment.ts']))).toBe(
      '/work/.launchway/deployment.ts',
    );
    expect(await findDeploymentFile(at('/work/a/b', []))).toBeUndefined();
  });
});

test('scanGlobalOptions reads both spellings and stops at --', () => {
  expect(
    scanGlobalOptions(['call', 'x', '--profile', 'a', '--tenant=b', '--', '--backend', 'c']),
  ).toEqual({
    profile: 'a',
    tenant: 'b',
  });
});
