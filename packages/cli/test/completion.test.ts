import { expect, test } from 'vitest';
import { createFakeHost } from './support/fake-host.ts';
import { portalServer } from './support/portal-server.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

test('completion prints a script per shell that calls back into the binary', async () => {
  const fake = createFakeHost();
  for (const shell of ['bash', 'zsh', 'fish']) {
    const run = await runCliWith(['completion', shell], fake.host);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('keelwerk __complete');
  }
  expect((await runCliWith(['completion', 'powershell'], fake.host)).code).toBe(2);
});

test('__complete answers from the cached surface without a network call', async () => {
  const fake = createFakeHost({ files: remoteProfileFiles, handler: portalServer() });
  await runCliWith(['call', 'list'], fake.host);
  const requests = fake.sent.length;
  const references = await runCliWith(['__complete', 'call', 'accounts.profile.c'], fake.host);
  expect(references.stdout.trim().split('\n')).toEqual(['accounts.profile.create']);
  const flags = await runCliWith(
    ['__complete', 'call', 'accounts.profile.create', '--ow'],
    fake.host,
  );
  expect(flags.stdout.trim()).toBe('--owner');
  const values = await runCliWith(
    ['__complete', 'call', 'accounts.profile.create', '--role', 'g'],
    fake.host,
  );
  expect(values.stdout.trim()).toBe('guest');
  expect(fake.sent).toHaveLength(requests);
});

test('the framework commands are listed in the tree', async () => {
  const run = await runCliWith(['--help'], createFakeHost().host);
  expect(run.stdout).toContain('call');
  expect(run.stdout).toContain('profile');
  expect(run.stdout).toContain('completion');
});
