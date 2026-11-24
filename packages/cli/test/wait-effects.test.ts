import { newUuidV7, renderTypeId } from '@keelwerk/core';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createFakeHost, type SentRequest } from './support/fake-host.ts';
import { json, portalServer } from './support/portal-server.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

const token = (n: number): string => `v2.0.${n}.00000000.${'0'.repeat(32)}`;
const head = (n: number): string =>
  `id: ${token(n)}\nevent: head\ndata: {"state":"${token(n)}"}\n\n`;

interface Scripted {
  readonly status: string;
  readonly error?: { readonly kind: string; readonly code: string };
}

/**
 * A deployment whose `app.health` answers with one requested effect, and whose status watch says what
 * `script` does with it: the statuses it reports (before head and after), and whether the stream stays open.
 */
function deployment(script: {
  readonly before?: Scripted;
  readonly after?: Scripted;
  readonly open?: boolean;
  readonly effects?: boolean;
}) {
  const effect = newUuidV7();
  const wireId = renderTypeId('eff', effect);
  const watched: Record<string, unknown>[] = [];
  const drained = Promise.withResolvers<void>();
  const status = (n: number, scripted: Scripted): string =>
    `id: ${token(n)}\nevent: data\ndata: ${JSON.stringify({
      id: wireId,
      type: 'hooks.post',
      status: scripted.status,
      requestedAt: '2026-11-19T10:00:00Z',
      ...(scripted.error !== undefined && { error: scripted.error }),
    })}\n\n`;
  let pulls = 0;
  const handler = portalServer({
    invoke: (body, sent: SentRequest) => {
      if (sent.url.endsWith('/subscribe')) {
        watched.push(body);
        const text = `${script.before === undefined ? '' : status(1, script.before)}${head(2)}${script.after === undefined ? '' : status(3, script.after)}`;
        const stream =
          script.open === true
            ? // Pulled only when the reader asks: the second pull is the client asking for more after the
              // status and the head it was given, so both have been taken in.
              new ReadableStream<Uint8Array>(
                {
                  pull(controller) {
                    if (pulls === 0) controller.enqueue(new TextEncoder().encode(text));
                    else drained.resolve();
                    pulls += 1;
                    if (pulls > 1) return new Promise<void>(() => undefined);
                  },
                },
                { highWaterMark: 0 },
              )
            : text;
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return json({
        ok: true,
        value: null,
        ...(script.effects === false ? {} : { effects: [effect] }),
      });
    },
  });
  return {
    fake: createFakeHost({ files: remoteProfileFiles, handler }),
    watched,
    wireId,
    drained: drained.promise,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Runs a command that waits one second on a watch that stays open. The clock is stepped: the limit is
 * reached by advancing it once the client has taken in the status and the head of the watch (the stream's
 * second pull), never by waiting for it.
 */
async function runPastLimit(
  deployed: ReturnType<typeof deployment>,
  argv: readonly string[],
): ReturnType<typeof runCliWith> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const run = runCliWith([...argv], deployed.fake.host);
  await deployed.drained;
  // Without the limit no timer runs: the wait would never end, so this is where it fails.
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1000);
  return run;
}

describe('call --wait-effects', () => {
  test('returns once the effect settled: one note per status, standard output keeps only the value', async () => {
    const { fake, watched, wireId } = deployment({
      before: { status: 'requested' },
      after: { status: 'succeeded' },
    });
    const run = await runCliWith(['call', 'app.health', '--wait-effects'], fake.host);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('null\n');
    expect(run.stderr).toContain(`effect ${wireId} hooks.post succeeded`);
    expect(watched).toEqual([{ action: 'core.effectStatusWatch', input: { ids: [wireId] } }]);
  });

  test('a failed effect ends the command with its own kind and code', async () => {
    const { fake } = deployment({
      before: { status: 'failed', error: { kind: 'unavailable', code: 'hooks.endpoint_down' } },
    });
    const run = await runCliWith(['call', 'app.health', '--wait-effects'], fake.host);
    expect(run.code).toBe(10);
    expect(run.stderr).toContain('hooks.endpoint_down');
  });

  test('an abandoned effect without an error is cli.effect_failed (1)', async () => {
    const { fake } = deployment({ before: { status: 'abandoned' } });
    const run = await runCliWith(['call', 'app.health', '--wait-effects'], fake.host);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('cli.effect_failed');
  });

  test('an effect the watch does not know is cli.effect_not_found (6)', async () => {
    const { fake } = deployment({});
    const run = await runCliWith(['call', 'app.health', '--wait-effects'], fake.host);
    expect(run.code).toBe(6);
    expect(run.stderr).toContain('cli.effect_not_found');
  });

  test('past the limit the status is noted and the command ends with cli.wait_timeout (10)', async () => {
    const deployed = deployment({ before: { status: 'requested' }, open: true });
    const { wireId } = deployed;
    const run = await runPastLimit(deployed, ['call', 'app.health', '--wait-effects', '1']);
    expect(run.code).toBe(10);
    expect(run.stderr).toContain(`effect ${wireId} hooks.post requested`);
    expect(run.stderr).toContain('cli.wait_timeout');
  });

  test('a watch that fails with core.timeout after the commit is cli.wait_failed, with the command id on standard error', async () => {
    const timeout =
      'event: error\ndata: {"kind":"unavailable","code":"core.timeout","message":"Too slow.","retryable":true,"requestId":"r"}\n\n';
    const fake = createFakeHost({
      files: remoteProfileFiles,
      handler: portalServer({
        invoke: (_body, sent: SentRequest) =>
          sent.url.endsWith('/subscribe')
            ? new Response(`event: welcome\ndata: {"protocol":1}\n\n${timeout}`, {
                status: 200,
                headers: { 'content-type': 'text/event-stream' },
              })
            : json({ ok: true, value: null, effects: [newUuidV7()] }),
      }),
    });
    const run = await runCliWith(
      ['call', 'app.health', '--wait-effects', '--command-id', 'cmd-77'],
      fake.host,
    );
    expect(run.code).toBe(10);
    expect(run.stderr).toContain(
      'note: command cmd-77 committed; its effects are not known to have settled',
    );
    expect(run.stderr).toContain('cli.wait_failed');
    expect(run.stderr).not.toContain('core.timeout"');
    expect(run.stderr).not.toContain('cli.unreachable');
  });

  test('a watch that cannot be reached after the commit is cli.wait_failed, not cli.unreachable, and names the command id minted by the CLI', async () => {
    let minted: unknown;
    const fake = createFakeHost({
      files: remoteProfileFiles,
      handler: portalServer({
        invoke: (body, sent: SentRequest) => {
          if (sent.url.endsWith('/subscribe')) throw new Error('connection refused');
          minted = body.commandId;
          return json({ ok: true, value: null, effects: [newUuidV7()] });
        },
      }),
    });
    const run = await runCliWith(['call', 'app.health', '--wait-effects'], fake.host);
    expect(minted).toEqual(expect.any(String));
    expect(run.code).toBe(10);
    expect(run.stderr).toContain(`note: command ${minted} committed`);
    expect(run.stderr).toContain('cli.wait_failed');
    expect(run.stderr).not.toContain('cli.unreachable');
  });

  test('under --output json a wait that failed after the commit is not retryable and carries the command id', async () => {
    const fake = createFakeHost({
      files: remoteProfileFiles,
      handler: portalServer({
        invoke: (_body, sent: SentRequest) => {
          if (sent.url.endsWith('/subscribe')) throw new Error('connection refused');
          return json({ ok: true, value: null, effects: [newUuidV7()] });
        },
      }),
    });
    const run = await runCliWith(
      ['call', 'app.health', '--wait-effects', '--command-id', 'cmd-78', '--output', 'json'],
      fake.host,
    );
    expect(run.code).toBe(10);
    const line = run.stderr.split('\n').find((text) => text.startsWith('{'));
    expect(JSON.parse(line ?? '{}')).toMatchObject({
      code: 'cli.wait_failed',
      retryable: false,
      details: { committed: true, commandId: 'cmd-78' },
    });
  });

  test('under --output json a wait that timed out or found no effect is not retryable and carries the command id', async () => {
    const timedOut = deployment({ before: { status: 'requested' }, open: true });
    const unknown = deployment({});
    const timeout = await runPastLimit(timedOut, [
      'call',
      'app.health',
      '--wait-effects',
      '1',
      '--command-id',
      'cmd-79',
      '--output',
      'json',
    ]);
    const missing = await runCliWith(
      ['call', 'app.health', '--wait-effects', '--command-id', 'cmd-80', '--output', 'json'],
      unknown.fake.host,
    );
    const errorOf = (stderr: string): unknown =>
      JSON.parse(stderr.split('\n').find((text) => text.startsWith('{')) ?? '{}');
    expect(errorOf(timeout.stderr)).toMatchObject({
      code: 'cli.wait_timeout',
      retryable: false,
      details: { committed: true, commandId: 'cmd-79' },
    });
    expect(errorOf(missing.stderr)).toMatchObject({
      code: 'cli.effect_not_found',
      retryable: false,
      details: { committed: true, commandId: 'cmd-80' },
    });
  });

  test('an answer that lists no effects waits for nothing', async () => {
    const { fake, watched } = deployment({ effects: false });
    const run = await runCliWith(['call', 'app.health', '--wait-effects'], fake.host);
    expect(run.code).toBe(0);
    expect(watched).toEqual([]);
  });
});
