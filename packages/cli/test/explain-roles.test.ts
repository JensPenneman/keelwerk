import { describe, expect, test } from 'vitest';
import { createFakeHost } from './support/fake-host.ts';
import { json, portalServer } from './support/portal-server.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

function decisionOf(principal: Record<string, unknown>) {
  return {
    mode: 'decision',
    action: 'library.addBook',
    kind: 'command',
    principal,
    scope: 'tenant jens',
    allowed: true,
    rules: [],
  };
}

async function explainText(answer: Record<string, unknown>) {
  const fake = createFakeHost({
    files: { ...remoteProfileFiles },
    handler: portalServer({ invoke: () => json({ ok: true, value: answer }) }),
  });
  return runCliWith(
    ['explain', 'library.addBook', '--as', 'user:ada', '--output', 'text'],
    fake.host,
  );
}

describe('explain roles', { timeout: 60_000 }, () => {
  test("the decision prints the principal's roles", async () => {
    const run = await explainText(
      decisionOf({ kind: 'user', id: 'ada', roles: ['reader', 'auditor'] }),
    );
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('  roles: reader, auditor');
  });

  test('no roles print as none, and an answer without roles prints no roles line', async () => {
    const none = await explainText(decisionOf({ kind: 'user', id: 'ada', roles: [] }));
    expect(none.stdout).toContain('  roles: none');
    const older = await explainText(decisionOf({ kind: 'user', id: 'ada' }));
    expect(older.stdout).not.toContain('roles:');
  });
});
