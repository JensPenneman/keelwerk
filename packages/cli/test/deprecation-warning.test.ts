import { describe, expect, test } from 'vitest';
import { deprecationOfHeaders } from '../src/context/deprecation-of-headers.ts';
import { deprecationWarning } from '../src/routes/deprecation-warning.ts';
import { createFakeHost } from './support/fake-host.ts';
import { portalServer } from './support/portal-server.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

const deprecated = {
  'content-type': 'application/json',
  'keelwerk-version': '2026-11-04',
  deprecation: '@1794268800',
  sunset: 'Wed, 02 Dec 2026 00:00:00 GMT',
  link: '</_keelwerk/v1/capabilities>; rel="deprecation"',
};

function host(headers: Record<string, string>) {
  return createFakeHost({
    files: remoteProfileFiles,
    handler: portalServer({
      invoke: () =>
        new Response(JSON.stringify({ ok: true, value: { ready: true } }), {
          status: 200,
          headers,
        }),
    }),
  });
}

describe('the deprecation warning of the CLI (18.5)', () => {
  test('a deprecated answer prints one warning on standard error and the value on standard out', async () => {
    const run = await runCliWith(['call', 'health'], host(deprecated).host);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ ready: true });
    expect(run.stderr).toBe(
      'warning: API version 2026-11-04 is deprecated since 2026-11-10 and retired after 2026-12-01.\n',
    );
  });

  test('an answer without Deprecation prints no warning', async () => {
    const run = await runCliWith(
      ['call', 'health'],
      host({ 'content-type': 'application/json', 'keelwerk-version': '2026-11-04' }).host,
    );
    expect(run.code).toBe(0);
    expect(run.stderr).toBe('');
  });

  test('deprecationOfHeaders tells a version link from an action link', () => {
    const version = deprecationOfHeaders(new Headers(deprecated), 'a.b');
    expect(version).toEqual({
      kind: 'deprecation',
      apiVersion: '2026-11-04',
      at: '2026-11-10',
      sunset: '2026-12-01',
    });
    const action = deprecationOfHeaders(new Headers({ deprecation: '@1794268800' }), 'a.b');
    expect(action).toEqual({ kind: 'deprecation', action: 'a.b', at: '2026-11-10' });
    expect(deprecationOfHeaders(new Headers(), 'a.b')).toBeUndefined();
    expect(deprecationWarning(action as never)).toBe(
      'warning: action a.b is deprecated since 2026-11-10.',
    );
  });

  test('an action deprecated without a date: a deprecation Link alone gives a notice without at', () => {
    const quiet = deprecationOfHeaders(
      new Headers({
        link: '</_keelwerk/v1/surface>; rel="deprecation"',
        sunset: 'Wed, 02 Dec 2026 00:00:00 GMT',
      }),
      'a.b',
    );
    expect(quiet).toEqual({ kind: 'deprecation', action: 'a.b', sunset: '2026-12-01' });
    expect(deprecationWarning(quiet as never)).toBe(
      'warning: action a.b is deprecated and retired after 2026-12-01.',
    );
    expect(deprecationWarning({ kind: 'deprecation', action: 'a.b' })).toBe(
      'warning: action a.b is deprecated.',
    );
    // A version link without Deprecation announces nothing: a deprecated version always has a date.
    expect(
      deprecationOfHeaders(
        new Headers({ link: '</_keelwerk/v1/capabilities>; rel="deprecation"' }),
        'a.b',
      ),
    ).toBeUndefined();
  });
});
