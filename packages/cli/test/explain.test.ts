import { describe, expect, test } from 'vitest';
import { explainHost } from './support/explain-host.ts';
import { createFakeHost } from './support/fake-host.ts';
import { json, portalServer } from './support/portal-server.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

const decision = {
  mode: 'decision',
  action: 'library.addBook',
  kind: 'command',
  principal: { kind: 'user', id: 'ada' },
  scope: 'tenant jens',
  allowed: true,
  rules: [
    {
      id: 'library.addBook.signedIn',
      effect: 'allow',
      module: 'library',
      file: 'src/policies/add-book/signed-in.ts',
    },
  ],
};

const dryRun = {
  mode: 'dry-run',
  authorization: decision,
  report: {
    status: 'decided',
    commandId: 'c-1',
    action: 'library.addBook',
    events: [
      {
        stream: 'library.book/b-1',
        version: 1,
        type: 'library.book.created',
        eventId: 'e-1',
        data: { values: { title: 'Dune' } },
        before: null,
      },
    ],
    effects: [
      { id: 'f-1', kind: 'external', type: 'library.notify', continuation: 'library.after' },
    ],
    deferred: ['f-1'],
    result: { bookId: 'b-1' },
    decision: {
      part: 'library.addBook',
      inputDigest: 'd',
      reads: [],
      answers: [],
      effects: ['f-1'],
    },
  },
};

describe('explain', { timeout: 60_000 }, () => {
  test('a reference asks for the decision and prints the rules with their files', async () => {
    const { fake, bodies } = explainHost(decision);
    const run = await runCliWith(
      [
        'explain',
        'library.addBook',
        '--input',
        '{"title":"Dune"}',
        '--as',
        'user:ada',
        '--output',
        'text',
      ],
      fake.host,
    );
    expect(run.code).toBe(0);
    expect(bodies[0]).toMatchObject({
      action: 'core.explain',
      input: {
        mode: 'decision',
        ref: 'library.addBook',
        backend: 'launchway',
        tenant: 'jens',
        input: { title: 'Dune' },
        as: 'user:ada',
      },
    });
    expect(run.stdout).toContain('library.addBook (command) for user ada in tenant jens: allowed');
    expect(run.stdout).toContain(
      'allow library.addBook.signedIn  [library] src/policies/add-book/signed-in.ts',
    );
  });

  test('--dry-run prints events with before-images, effects with ids and the decision record', async () => {
    const { fake, bodies } = explainHost(dryRun);
    const run = await runCliWith(
      [
        'explain',
        'library.addBook',
        '--dry-run',
        '--input',
        '{}',
        '--answer',
        'library.lookup={"ok":true}',
        '--command-id',
        'c-1',
        '--roles',
        'staff, admin',
        '--as',
        'user:ada',
        '--output',
        'text',
      ],
      fake.host,
    );
    expect(run.code).toBe(0);
    expect(bodies[0]).toMatchObject({
      input: {
        mode: 'dry-run',
        commandId: 'c-1',
        answers: { 'library.lookup': { ok: true } },
        roles: ['staff', 'admin'],
      },
    });
    expect(run.stdout).toContain('nothing was written');
    expect(run.stdout).toContain('library.book/b-1 v1 library.book.created');
    expect(run.stdout).toContain('before: null');
    expect(run.stdout).toContain('f-1 external library.notify -> library.after');
    expect(run.stdout).toContain('decision record: {"part":"library.addBook"');
  });

  test('a dry run that stops at an inline effect says which one', async () => {
    const { fake } = explainHost({
      mode: 'dry-run',
      authorization: decision,
      report: {
        status: 'would-perform',
        action: 'library.checked',
        effect: 'library.lookup',
        input: { to: 'x' },
      },
    });
    const run = await runCliWith(
      ['explain', 'library.checked', '--dry-run', '--output', 'text'],
      fake.host,
    );
    expect(run.stdout).toContain('library.lookup would perform {"to":"x"}');
  });

  test('--trace prints the tree and sends only the id', async () => {
    const { fake, bodies } = explainHost({
      mode: 'trace',
      requested: { kind: 'effect', id: 'f-1' },
      command: {
        commandId: 'c-1',
        action: 'library.addBook',
        actor: { kind: 'user', id: 'ada' },
        events: [
          { eventId: 'e-1', stream: 'library.book/b-1', version: 1, type: 'library.book.created' },
        ],
        decision: null,
        effects: [
          {
            id: 'f-1',
            type: 'library.notify',
            status: 'succeeded',
            events: [],
            continuations: [
              {
                commandId: 'c-2',
                action: 'library.after',
                actor: { kind: 'service', id: 'x' },
                events: [],
                effects: [],
                nested: [],
              },
            ],
          },
        ],
        nested: [],
      },
    });
    const run = await runCliWith(['explain', '--trace', 'f-1', '--output', 'text'], fake.host);
    expect(bodies[0]).toMatchObject({
      input: { mode: 'trace', id: 'f-1', backend: 'launchway', tenant: 'jens' },
    });
    expect(run.stdout).toContain('trace of effect f-1');
    expect(run.stdout).toContain('effect f-1 library.notify succeeded');
    expect(run.stdout).toContain('command c-2 library.after by service x');
  });

  test('--output json prints the answer as it came', async () => {
    const { fake } = explainHost(decision);
    const run = await runCliWith(['explain', 'library.addBook', '--output', 'json'], fake.host);
    expect(JSON.parse(run.stdout)).toMatchObject({ mode: 'decision', allowed: true });
  });

  test('a server error ends the command with its exit code', async () => {
    const fake = createFakeHost({
      files: remoteProfileFiles,
      handler: portalServer({
        invoke: () =>
          json({
            ok: false,
            error: {
              kind: 'forbidden',
              code: 'core.forbidden',
              message: 'keelwerk explain is for operators.',
              retryable: false,
              requestId: 'r',
            },
          }),
      }),
    });
    const run = await runCliWith(['explain', 'library.addBook'], fake.host);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain('core.forbidden');
  });

  const redecided = {
    mode: 'redecide',
    commandId: 'c-9',
    part: 'library.book.update',
    reproduced: true,
    differences: [],
  };

  test('explain --redecide sends mode redecide with the command id', async () => {
    const { fake, bodies } = explainHost(redecided);
    const run = await runCliWith(
      ['explain', '--redecide', 'c-9', '--input', '{"id":"b-1"}', '--output', 'text'],
      fake.host,
    );
    expect(run.code).toBe(0);
    expect(bodies[0]).toMatchObject({
      action: 'core.explain',
      input: {
        mode: 'redecide',
        commandId: 'c-9',
        backend: 'launchway',
        tenant: 'jens',
        input: { id: 'b-1' },
      },
    });
  });

  test('explain --redecide --api-version sends the version, and without it sends none', async () => {
    const given = explainHost(redecided);
    const run = await runCliWith(
      ['explain', '--redecide', 'c-9', '--api-version', '2026-01-01', '--output', 'text'],
      given.fake.host,
    );
    expect(run.code).toBe(0);
    expect(given.bodies[0]).toMatchObject({
      input: { mode: 'redecide', commandId: 'c-9', apiVersion: '2026-01-01' },
    });
    const without = explainHost(redecided);
    await runCliWith(['explain', '--redecide', 'c-9', '--output', 'text'], without.fake.host);
    expect(without.bodies[0]?.input).not.toHaveProperty('apiVersion');
    const misplaced = await runCliWith(
      ['explain', 'library.addBook', '--api-version', '2026-01-01'],
      explainHost(redecided).fake.host,
    );
    expect(misplaced.code).toBe(2);
  });

  test("explain --redecide --api-version '' sends the empty version", async () => {
    const { fake, bodies } = explainHost(redecided);
    const run = await runCliWith(
      ['explain', '--redecide', 'c-9', '--api-version', '', '--output', 'text'],
      fake.host,
    );
    expect(run.code).toBe(0);
    expect(bodies[0]?.input).toMatchObject({ mode: 'redecide', commandId: 'c-9', apiVersion: '' });
  });

  test('usage mistakes are refused before any request', async () => {
    const { fake } = explainHost(decision);
    for (const argv of [
      ['explain'],
      ['explain', 'library.addBook', '--trace', 'x'],
      ['explain', 'library.addBook', '--answer', 'x=1'],
      ['explain', 'library.addBook', '--dry-run', '--answer', 'nojson'],
      ['explain', 'library.addBook', '--dry-run', '--answer', 'e={bad'],
    ]) {
      const run = await runCliWith(argv, fake.host);
      expect(run.code, argv.join(' ')).toBe(2);
    }
    expect(fake.sent.filter((sent) => sent.url.endsWith('/invoke'))).toEqual([]);
  });
});
