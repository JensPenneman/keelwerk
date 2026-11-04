import { expect, test } from 'vitest';
import { createFakeHost } from './support/fake-host.ts';
import { json, portalServer } from './support/portal-server.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

function failingThenOk(failures: number) {
  let remaining = failures;
  const ok = portalServer({ invoke: () => json({ ok: true, value: { done: true } }) });
  return (sent: Parameters<typeof ok>[0]) => {
    if (sent.url.endsWith('/invoke') && remaining > 0) {
      remaining -= 1;
      throw new TypeError('fetch failed');
    }
    return ok(sent);
  };
}

function commandIds(sent: readonly { url: string; request: { body?: string } }[]): unknown[] {
  return sent
    .filter((request) => request.url.endsWith('/invoke'))
    .map(
      (request) => (JSON.parse(request.request.body ?? '{}') as { commandId?: string }).commandId,
    );
}

test('the command id is generated once and reused by every network retry', async () => {
  const fake = createFakeHost({ files: remoteProfileFiles, handler: failingThenOk(2) });
  const run = await runCliWith(['call', 'accounts.register', '--display-name', 'J'], fake.host);
  expect(run.code).toBe(0);
  const ids = commandIds(fake.sent);
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(1);
  expect(ids[0]).toMatch(/^00000000-0000-7000-8000-/);
  expect(fake.sleeps).toHaveLength(2);
});

test('a given --command-id is used as it is', async () => {
  const fake = createFakeHost({ files: remoteProfileFiles, handler: failingThenOk(1) });
  await runCliWith(['call', 'app.health', '--command-id', 'my-command'], fake.host);
  expect(commandIds(fake.sent)).toEqual(['my-command', 'my-command']);
});

test('when every attempt fails the command ends unavailable (10)', async () => {
  const fake = createFakeHost({ files: remoteProfileFiles, handler: failingThenOk(10) });
  const run = await runCliWith(['call', 'app.health', '--output', 'text'], fake.host);
  expect(run.code).toBe(10);
  expect(run.stderr).toContain('error[cli.unreachable]');
  expect(commandIds(fake.sent)).toHaveLength(3);
});
