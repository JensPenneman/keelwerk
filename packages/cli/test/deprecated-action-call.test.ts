import { startTestRuntime, testPrincipal } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { deprecationOfHeaders } from '../src/context/deprecation-of-headers.ts';
import { deprecatedPingApp, deprecationDay } from './support/deprecated-ping-app.ts';
import { createFakeHost } from './support/fake-host.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

let now = Temporal.Instant.from('2026-11-04T10:00:00Z');
let runtime: Awaited<ReturnType<typeof boot>>;

function boot() {
  return startTestRuntime(deprecatedPingApp, {
    host: httpHost(),
    tenants: ['acme'],
    clock: { now: () => now },
  });
}

beforeAll(async () => {
  runtime = await boot();
});
afterAll(() => runtime.stop());

/** Sends the request to the test runtime as a signed-in user of its tenant. */
function request(url: string, init: RequestInit, headers: Record<string, string>): Request {
  return new Request(url, {
    ...init,
    headers: {
      ...headers,
      'x-tenant': runtime.tenants.acme.id,
      // The header the test runtime's principal resolver reads.
      'x-test-principal': JSON.stringify(testPrincipal('ada')),
    },
  });
}

async function invoke(action = 'chores.oldPing'): Promise<Response> {
  return runtime.fetch(
    request(
      'https://lvj.example/_keelwerk/v1/invoke',
      {
        method: 'POST',
        body: JSON.stringify({ action, input: {} }),
      },
      { 'content-type': 'application/json' },
    ),
  );
}

async function callWithCli(action = 'chores.oldPing') {
  const fake = createFakeHost({
    files: remoteProfileFiles,
    handler: ({ url, request: sent }) =>
      runtime.fetch(
        request(
          url,
          {
            method: sent.method,
            ...(sent.body === undefined ? {} : { body: sent.body }),
          },
          sent.headers,
        ),
      ),
  });
  return runCliWith(['call', action, '--output', 'json'], fake.host);
}

describe('a deprecated action over POST /invoke and the CLI (18.5)', () => {
  test('before its date the answer carries no deprecation header and the CLI prints no warning', async () => {
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(response.headers.get('deprecation')).toBeNull();
    expect(response.headers.get('sunset')).toBeNull();
    expect(deprecationOfHeaders(response.headers, 'chores.oldPing')).toBeUndefined();
    const run = await callWithCli();
    expect(run.code).toBe(0);
    expect(run.stderr).toBe('');
  });

  test('from its date the answer carries Keelwerk-Version, Deprecation and Sunset, and the CLI warns for the same call', async () => {
    now = Temporal.Instant.from(`${deprecationDay}T00:00:01Z`);
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(response.headers.get('keelwerk-version')).not.toBeNull();
    expect(response.headers.get('deprecation')).toBe('@1793836800');
    expect(response.headers.get('sunset')).toBe('Wed, 02 Dec 2026 00:00:00 GMT');
    expect(response.headers.get('link')).toBe('</_keelwerk/v1/surface>; rel="deprecation"');
    expect(deprecationOfHeaders(response.headers, 'chores.oldPing')).toEqual({
      kind: 'deprecation',
      action: 'chores.oldPing',
      at: deprecationDay,
      sunset: '2026-12-01',
    });
    const run = await callWithCli();
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ pong: true });
    expect(run.stderr).toBe(
      `warning: action chores.oldPing is deprecated since ${deprecationDay} and retired after 2026-12-01.\n`,
    );
  });

  test('an action deprecated without a date is announced at once, with no Deprecation header and a warning without a date', async () => {
    now = Temporal.Instant.from('2026-11-01T10:00:00Z');
    const response = await invoke('chores.quietPing');
    expect(response.status).toBe(200);
    expect(response.headers.has('deprecation')).toBe(false);
    expect(response.headers.get('sunset')).toBe('Wed, 02 Dec 2026 00:00:00 GMT');
    expect(response.headers.get('link')).toBe('</_keelwerk/v1/surface>; rel="deprecation"');
    expect(deprecationOfHeaders(response.headers, 'chores.quietPing')).toEqual({
      kind: 'deprecation',
      action: 'chores.quietPing',
      sunset: '2026-12-01',
    });
    const run = await callWithCli('chores.quietPing');
    expect(run.code).toBe(0);
    expect(run.stderr).toBe(
      'warning: action chores.quietPing is deprecated and retired after 2026-12-01.\n',
    );
  });
});
