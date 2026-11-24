import { describe, expect, test } from 'vitest';
import { createFakeHost, type SentRequest } from './support/fake-host.ts';
import { json, portalServer } from './support/portal-server.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

const html = (status: number) =>
  new Response('<html>gate</html>', { status, headers: { 'content-type': 'text/html' } });

describe('call when /invoke answers without an error code', () => {
  test.each([
    ['401', () => json({ message: 'no' }, 401), 4],
    ['403', () => json({ message: 'no' }, 403), 5],
    ['404', () => json({ detail: 'none' }, 404), 6],
    ['429', () => json({ message: 'slow' }, 429), 8],
    ['408', () => json({ message: 'late' }, 408), 10],
    ['500', () => json({ message: 'broken' }, 500), 10],
    ['502', () => json({ message: 'proxy' }, 502), 10],
    ['400', () => json({ message: 'bad' }, 400), 1],
    ['200 without an envelope', () => json({ hello: 'world' }, 200), 1],
    ['401 not JSON', () => html(401), 4],
    ['429 not JSON', () => html(429), 8],
  ] as const)('%s ends by its status and prints no stack trace', async (_name, answer, code) => {
    const fake = createFakeHost({
      files: remoteProfileFiles,
      handler: portalServer({ invoke: () => answer() }),
    });
    const run = await runCliWith(['call', 'app.health'], fake.host);
    expect(run.code).toBe(code);
    expect(run.stderr).toContain('cli.bad_response');
    expect(run.stderr).not.toContain('TypeError');
    expect(run.stderr).not.toMatch(/\n\s+at /);
  });
});

describe('call --async --wait-effects without --wait', () => {
  test('is a usage error that names --wait, and nothing is sent', async () => {
    const sent: string[] = [];
    const fake = createFakeHost({
      files: remoteProfileFiles,
      handler: portalServer({
        invoke: (_body, request: SentRequest) => {
          sent.push(request.url);
          return json({ ok: true, value: null });
        },
      }),
    });
    const run = await runCliWith(['call', 'app.health', '--async', '--wait-effects'], fake.host);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('--wait-effects needs the result of the command: add --wait');
    expect(sent).toEqual([]);
  });
});
