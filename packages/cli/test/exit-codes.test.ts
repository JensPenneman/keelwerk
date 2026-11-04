import type { ErrorKind, WireError } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { exitCodeFor } from '../src/exit-code-for.ts';
import { createFakeHost } from './support/fake-host.ts';
import { json, portalServer } from './support/portal-server.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

const expected: readonly (readonly [ErrorKind, number])[] = [
  ['validation', 3],
  ['unauthenticated', 4],
  ['forbidden', 5],
  ['not_found', 6],
  ['conflict', 7],
  ['rate_limited', 8],
  ['not_implemented', 9],
  ['unavailable', 10],
  ['unsupported', 11],
  ['internal', 1],
];

function wire(kind: ErrorKind): WireError {
  return {
    kind,
    code: 'accounts.email_taken',
    message: 'This e-mail address is already in use.',
    retryable: false,
    issues: [{ path: ['email'], message: 'taken' }],
    requestId: 'req_1',
  };
}

describe('exit codes', () => {
  test.each(expected)('exitCodeFor(%s) is %i', (kind, code) => {
    expect(exitCodeFor(wire(kind))).toBe(code);
  });

  test('usage is 2 and an interrupt is 130', () => {
    expect(exitCodeFor('usage')).toBe(2);
    expect(exitCodeFor('interrupted')).toBe(130);
  });

  test.each(expected)('a %s answer ends the command with exit code %i', async (kind, code) => {
    const fake = createFakeHost({
      files: remoteProfileFiles,
      handler: portalServer({ invoke: () => json({ ok: false, error: wire(kind) }, 422) }),
    });
    const run = await runCliWith(['call', 'app.health', '--output', 'text'], fake.host);
    expect(run.code).toBe(code);
    expect(run.stderr).toBe(
      'error[accounts.email_taken]: This e-mail address is already in use.\n  email: taken\n  request id: req_1\n',
    );
    expect(run.stdout).toBe('');
  });

  test('with --output json standard error receives the wire error', async () => {
    const fake = createFakeHost({
      files: remoteProfileFiles,
      handler: portalServer({ invoke: () => json({ ok: false, error: wire('conflict') }, 409) }),
    });
    const run = await runCliWith(['call', 'app.health', '--output', 'json'], fake.host);
    expect(run.code).toBe(7);
    expect(JSON.parse(run.stderr)).toEqual(wire('conflict'));
  });

  test('an unknown command, an unknown flag and a bad value are usage errors (2)', async () => {
    const fake = createFakeHost({ files: remoteProfileFiles, handler: portalServer() });
    expect((await runCliWith(['nope'], fake.host)).code).toBe(2);
    expect((await runCliWith(['call', 'app.health', '--bogus'], fake.host)).code).toBe(2);
    expect(
      (await runCliWith(['call', 'accounts.profile.create', '--age', 'abc'], fake.host)).code,
    ).toBe(2);
    expect((await runCliWith(['call', 'no.such.action'], fake.host)).code).toBe(2);
  });

  test('an interrupt while a request is in flight ends with 130', async () => {
    const controller = new AbortController();
    const fake = createFakeHost({
      files: remoteProfileFiles,
      handler: (sent) => {
        if (sent.url.endsWith('/surface')) {
          return portalServer()(sent);
        }
        return new Promise<Response>((_resolve, reject) => {
          sent.request.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
          setTimeout(() => controller.abort(), 0);
        });
      },
    });
    const run = await runCliWith(['call', 'app.health'], fake.host, controller.signal);
    expect(run.code).toBe(130);
  });
});
