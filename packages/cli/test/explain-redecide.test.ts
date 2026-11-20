import { describe, expect, test } from 'vitest';
import { explainHost } from './support/explain-host.ts';
import { createFakeHost } from './support/fake-host.ts';
import { json, portalServer } from './support/portal-server.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

const redecided = {
  mode: 'redecide',
  commandId: 'c-9',
  part: 'library.book.update',
  reproduced: true,
  differences: [],
};

describe('explain --redecide', { timeout: 60_000 }, () => {
  test('explain --redecide prints reproduces, or each difference', async () => {
    const same = await runCliWith(
      ['explain', '--redecide', 'c-9', '--output', 'text'],
      explainHost(redecided).fake.host,
    );
    expect(same.stdout).toContain('library.book.update c-9: reproduces');
    const other = explainHost({
      ...redecided,
      reproduced: false,
      differences: ['event 1 (library.book.changed of library.book/b-1): data differs'],
      refused: 'core.replay_key_destroyed',
    });
    const run = await runCliWith(
      ['explain', '--redecide', 'c-9', '--output', 'text'],
      other.fake.host,
    );
    expect(run.stdout).toContain('library.book.update c-9: differs');
    expect(run.stdout).toContain(
      '  - event 1 (library.book.changed of library.book/b-1): data differs',
    );
    expect(run.stdout).toContain('  refused: core.replay_key_destroyed');
  });

  test('--redecide with a reference is a usage error', async () => {
    const { fake } = explainHost(redecided);
    for (const argv of [
      ['explain', 'library.addBook', '--redecide', 'c-9'],
      ['explain', '--redecide', 'c-9', '--trace', 'x'],
      ['explain', '--redecide', 'c-9', '--dry-run'],
    ]) {
      const run = await runCliWith(argv, fake.host);
      expect(run.code, argv.join(' ')).toBe(2);
    }
    expect(fake.sent.filter((sent) => sent.url.endsWith('/invoke'))).toEqual([]);
  });

  test('--redecide with --as, --roles, --command-id or --answer is a usage error, as with --trace and --dry-run', async () => {
    const { fake } = explainHost(redecided);
    for (const argv of [
      ['explain', '--redecide', 'c-9', '--as', 'user:ada'],
      ['explain', '--redecide', 'c-9', '--roles', 'a,b'],
      ['explain', '--redecide', 'c-9', '--command-id', 'c-1'],
      ['explain', '--redecide', 'c-9', '--answer', 'e=1'],
    ]) {
      const run = await runCliWith(argv, fake.host);
      expect(run.code, argv.join(' ')).toBe(2);
    }
    expect(fake.sent.filter((sent) => sent.url.endsWith('/invoke'))).toEqual([]);
  });

  test('a command that wrote no decision record (hooks.testEndpoint) ends with the validation the server answers', async () => {
    const fake = createFakeHost({
      files: remoteProfileFiles,
      handler: portalServer({
        invoke: () =>
          json({
            ok: false,
            error: {
              kind: 'validation',
              code: 'core.validation',
              message:
                'Command c-9 wrote no events with a decision record (7.9.6); its inline effects are in core.effect.',
              retryable: false,
              requestId: 'r',
            },
          }),
      }),
    });
    const run = await runCliWith(['explain', '--redecide', 'c-9', '--output', 'text'], fake.host);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain('core.validation');
    expect(run.stderr).toContain('wrote no events with a decision record');
  });
});
