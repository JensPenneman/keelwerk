import { describe, expect, test } from 'vitest';
import { flagFor } from '../src/routes/flag-for.ts';
import { flagTable } from '../src/routes/flag-table.ts';
import type { SentRequest } from './support/fake-host.ts';
import { createFakeHost } from './support/fake-host.ts';
import { json, portalServer } from './support/portal-server.ts';
import { portalSurface } from './support/portal-surface.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

function invokeBodies(sent: readonly SentRequest[]): Record<string, unknown>[] {
  return sent
    .filter((request) => request.url.endsWith('/invoke'))
    .map((request) => JSON.parse(request.request.body ?? '{}') as Record<string, unknown>);
}

function setup(answer?: (body: Record<string, unknown>) => Response) {
  return createFakeHost({
    files: remoteProfileFiles,
    handler: portalServer(answer === undefined ? {} : { invoke: (body) => answer(body) }),
  });
}

describe('call: routes and flags for every field kind', () => {
  test('the fixture covers a flag for each input kind and sends wire values', async () => {
    const fake = setup();
    fake.bytes.set('/work/project/avatar.bin', new Uint8Array([1, 2, 3, 250]));
    fake.files.set('/work/project/notes.txt', { text: 'hello notes', mode: 0o644 });
    const run = await runCliWith(
      [
        'call',
        'accounts.profile.create',
        '--name',
        'Jens',
        '--bio',
        '@notes.txt',
        '--age',
        '42',
        '--balance',
        '12345678901234567890',
        '--price',
        '10.50',
        '--score',
        '2.5',
        '--active',
        '--joined-at',
        '2026-11-05T10:00:00+01:00',
        '--birthday',
        '1984-02-29',
        '--zone',
        'Europe/Brussels',
        '--role',
        'admin',
        '--owner',
        'prof_01h455vb4pex5vsknk084sn02q',
        '--tags',
        'a',
        '--tags',
        'b',
        '--roles',
        'admin',
        '--roles',
        'guest',
        '--address.city',
        'Gent',
        '--address.postcode',
        '9000',
        '--settings-json',
        '{"theme":"dark"}',
        '--avatar',
        '@avatar.bin',
        '--notes',
        '@notes.txt',
        '--subject',
        'user:jens',
        '--password-stdin',
      ],
      createFakeHostWithStdin(fake, 'hunter2\n'),
    );
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    const [body] = invokeBodies(fake.sent);
    expect(body?.action).toBe('accounts.profile.create');
    expect(body?.input).toEqual({
      name: 'Jens',
      bio: 'hello notes',
      age: 42,
      balance: '12345678901234567890',
      price: '10.50',
      score: 2.5,
      active: true,
      joinedAt: '2026-11-05T09:00:00Z',
      birthday: '1984-02-29',
      zone: 'Europe/Brussels',
      role: 'admin',
      owner: 'prof_01h455vb4pex5vsknk084sn02q',
      tags: ['a', 'b'],
      roles: ['admin', 'guest'],
      address: { city: 'Gent', postcode: '9000' },
      settings: { theme: 'dark' },
      avatar: 'AQID-g',
      notes: 'hello notes',
      password: 'hunter2',
      subject: 'user:jens',
    });
  });

  test('subject is a string flag; foreign (--input only) and blob (not settable) get no flag', () => {
    const create = portalSurface.actions.find((action) => action.ref === 'accounts.profile.create');
    if (create === undefined) {
      throw new Error('the fixture has no accounts.profile.create');
    }
    const keys = flagTable(create).map((entry) => entry.key);
    expect(keys).toContain('subject');
    expect(keys).not.toContain('extra');
    expect(keys).not.toContain('attachment');
    const subject = flagTable(create).find((entry) => entry.key === 'subject');
    expect(subject === undefined ? undefined : flagFor('subject', subject.node)).toMatchObject({
      kind: 'parsed',
    });
  });

  test('a foreign field is given with --input', async () => {
    const fake = setup();
    const run = await runCliWith(
      [
        'call',
        'accounts.profile.create',
        '--name',
        'A',
        '--password-stdin',
        '--input',
        '{"extra":{"a":1}}',
      ],
      fake.host,
    );
    expect(run.code).toBe(0);
    expect(invokeBodies(fake.sent)[0]?.input).toEqual({ name: 'A', password: '', extra: { a: 1 } });
  });

  test('--no-active sends false and a field named like a common flag is reached with --input', async () => {
    const fake = setup();
    await runCliWith(
      [
        'call',
        'accounts.profile.create',
        '--no-active',
        '--password-stdin',
        '--input',
        '{"output":"x","name":"A"}',
        '--name',
        'B',
      ],
      fake.host,
    );
    expect(invokeBodies(fake.sent)[0]?.input).toEqual({
      output: 'x',
      name: 'B',
      active: false,
      password: '',
    });
  });

  test('an instance command takes the id first, then cli.positional, and --if-version', async () => {
    const fake = setup();
    const run = await runCliWith(
      [
        'call',
        'accounts.profile.deactivate',
        'prof_01h455vb4pex5vsknk084sn02q',
        'left',
        '--if-version',
        '3',
      ],
      fake.host,
    );
    expect(run.code).toBe(0);
    expect(invokeBodies(fake.sent)[0]?.input).toEqual({
      id: 'prof_01h455vb4pex5vsknk084sn02q',
      reason: 'left',
      ifVersion: 3,
    });
  });

  test('a command whose input requires ifVersion refuses to run without --if-version (2)', async () => {
    const strict = {
      ...portalSurface,
      actions: portalSurface.actions.map((candidate) => {
        const input = candidate.input;
        const version = input.kind === 'shape' ? input.fields.ifVersion : undefined;
        return input.kind !== 'shape' || version === undefined
          ? candidate
          : {
              ...candidate,
              input: {
                ...input,
                fields: { ...input.fields, ifVersion: { ...version, optional: false } },
              },
            };
      }),
    };
    const portal = portalServer();
    const fake = createFakeHost({
      files: remoteProfileFiles,
      handler: (sent) => (sent.url.endsWith('/surface') ? json(strict) : portal(sent)),
    });
    const id = 'prof_01h455vb4pex5vsknk084sn02q';
    const without = await runCliWith(
      ['call', 'accounts.profile.deactivate', id, 'left'],
      fake.host,
    );
    expect(without.code).toBe(2);
    expect(invokeBodies(fake.sent)).toEqual([]);
    const given = await runCliWith(
      ['call', 'accounts.profile.deactivate', id, 'left', '--if-version', '3'],
      fake.host,
    );
    expect(given.code).toBe(0);
    const sentBefore = invokeBodies(fake.sent).length;
    const viaInput = await runCliWith(
      ['call', 'accounts.profile.deactivate', id, '--input', '{"reason":"left","ifVersion":3}'],
      fake.host,
    );
    expect(viaInput.code).toBe(0);
    expect(invokeBodies(fake.sent)).toHaveLength(sentBefore + 1);
    expect(invokeBodies(fake.sent)[sentBefore]?.input).toMatchObject({ ifVersion: 3 });
    const neither = await runCliWith(
      ['call', 'accounts.profile.deactivate', id, '--input', '{"reason":"left"}'],
      fake.host,
    );
    expect(neither.code).toBe(2);
    expect(neither.stderr).toContain('--if-version');
    expect(invokeBodies(fake.sent)).toHaveLength(sentBefore + 1);
  });

  test('an id with the wrong prefix is a usage error (2) and nothing is sent', async () => {
    const fake = setup();
    const run = await runCliWith(
      ['call', 'accounts.profile.deactivate', 'cred_01h455vb4pex5vsknk084sn02q', 'x'],
      fake.host,
    );
    expect(run.code).toBe(2);
    expect(invokeBodies(fake.sent)).toEqual([]);
  });

  test('cli.aliases add shorter references, and a void action sends no input', async () => {
    const fake = setup((body) =>
      json({ ok: true, value: { ready: body.action === 'app.health' } }),
    );
    const run = await runCliWith(['call', 'health'], fake.host);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ ready: true });
    expect(invokeBodies(fake.sent)[0]).not.toHaveProperty('input');
  });

  test('call list prints every reference of the surface', async () => {
    const fake = setup();
    const run = await runCliWith(['call', 'list'], fake.host);
    const refs = (JSON.parse(run.stdout) as { ref: string }[]).map((row) => row.ref);
    expect(refs).toContain('accounts.profile.create');
    expect(refs).toContain('auth.sessionEvents');
  });

  test('a subscription ends with the unavailable error of this release (exit 10)', async () => {
    const fake = setup();
    const run = await runCliWith(['call', 'auth.sessionEvents', '--output', 'text'], fake.host);
    expect(run.code).toBe(10);
    expect(run.stderr).toContain('error[core.live_unavailable]');
    expect(invokeBodies(fake.sent)).toEqual([]);
  });

  test('--async asks for a receipt and prints the command id', async () => {
    const fake = setup((body) =>
      json({
        ok: true,
        value: null,
        receipt: { commandId: String(body.commandId), status: 'accepted' },
      }),
    );
    const run = await runCliWith(
      [
        'call',
        'accounts.register',
        '--display-name',
        'J',
        '--email',
        'j@x.io',
        '--async',
        '--output',
        'text',
      ],
      fake.host,
    );
    expect(run.stdout).toBe('command 00000000-0000-7000-8000-000000000001 accepted\n');
    expect(invokeBodies(fake.sent)[0]?.prefer).toBe('async');
  });
});

function createFakeHostWithStdin(fake: ReturnType<typeof createFakeHost>, stdin: string) {
  return { ...fake.host, readStdin: async () => stdin };
}
