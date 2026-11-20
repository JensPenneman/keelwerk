import { describe, expect, test } from 'vitest';
import { exitCodeFor } from '../src/exit-code-for.ts';
import {
  followDeployment as deployment,
  end,
  followHead as head,
  followItem as item,
  outputLines as lines,
  sse,
  token,
  welcome,
} from './support/follow-deployment.ts';
import { json } from './support/portal-server.ts';
import { runCliWith } from './support/run-cli-with.ts';

describe('call <subscription>', () => {
  test('stops at head without --follow: the changes up to now are printed as NDJSON, exit 0', async () => {
    const { fake, opened } = deployment([
      () => sse(welcome, item(1, 'first'), head(2), item(3, 'later'), end),
    ]);
    const run = await runCliWith(['call', 'auth.sessionEvents'], fake.host);
    expect(run.code).toBe(0);
    expect(lines(run.stdout).map((line) => JSON.parse(line))).toEqual([
      { state: token(1), item: 'first' },
    ]);
    expect(opened).toEqual([{ action: 'auth.sessionEvents' }]);
  });

  test('--follow keeps reading past head until the stream ends', async () => {
    const { fake } = deployment([
      () => sse(welcome, item(1, 'first'), head(2), item(3, 'later'), end),
    ]);
    const run = await runCliWith(['call', 'auth.sessionEvents', '--follow'], fake.host);
    expect(run.code).toBe(0);
    expect(lines(run.stdout).map((line) => JSON.parse(line))).toEqual([
      { state: token(1), item: 'first' },
      { state: token(3), item: 'later' },
    ]);
  });

  test('--follow prints an event with a member called control as an item, whatever it says', async () => {
    const { fake, opened } = deployment([
      () =>
        sse(
          welcome,
          head(1),
          item(2, { control: 'reset' }),
          item(3, { control: 'head' }),
          item(4, { control: 'gap' }),
          end,
        ),
    ]);
    const run = await runCliWith(['call', 'auth.sessionEvents', '--follow'], fake.host);
    expect(run.code).toBe(0);
    expect(lines(run.stdout).map((line) => JSON.parse(line))).toEqual([
      { state: token(2), item: { control: 'reset' } },
      { state: token(3), item: { control: 'head' } },
      { state: token(4), item: { control: 'gap' } },
    ]);
    // No reset restarted the stream: it was opened once, from the start.
    expect(opened).toEqual([{ action: 'auth.sessionEvents' }]);
  });

  test('--follow resumes from the last token when the connection is cut', async () => {
    const { fake, opened } = deployment([
      () => sse(welcome, head(1), item(2, 'one')),
      () => sse(welcome, item(3, 'two'), end),
    ]);
    const run = await runCliWith(['call', 'auth.sessionEvents', '--follow'], fake.host);
    expect(run.code).toBe(0);
    expect(lines(run.stdout).map((line) => JSON.parse(line))).toEqual([
      { state: token(2), item: 'one' },
      { state: token(3), item: 'two' },
    ]);
    expect(opened).toEqual([
      { action: 'auth.sessionEvents' },
      { action: 'auth.sessionEvents', after: token(2) },
    ]);
  });

  test('a reset the client cannot repair is a note on standard error, and the stream starts again', async () => {
    const reset = 'event: reset\ndata: {"reason":"resync"}\n\n';
    const { fake, opened } = deployment([
      () => sse(welcome, item(1, 'one'), reset),
      () => sse(welcome, head(5), item(6, 'two'), end),
    ]);
    const run = await runCliWith(['call', 'auth.sessionEvents', '--follow'], fake.host);
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('resync');
    expect(opened[1]).toEqual({ action: 'auth.sessionEvents' });
    expect(lines(run.stdout)).toHaveLength(2);
  });

  test('a reset the client cannot repair says on standard error that it starts from now and the caller queries again', async () => {
    const reset = 'event: reset\ndata: {"reason":"resync"}\n\n';
    const { fake } = deployment([
      () => sse(welcome, item(1, 'before'), reset),
      () => sse(welcome, head(5), item(6, 'after'), end),
    ]);
    const run = await runCliWith(['call', 'auth.sessionEvents', '--follow'], fake.host);
    expect(run.code).toBe(0);
    expect(run.stderr).toBe(
      'note: the subscription was reset (resync) and starts again from now; changes before now may be missing, so query again.\n',
    );
    expect(lines(run.stdout).map((line) => JSON.parse(line))).toEqual([
      { state: token(1), item: 'before' },
      { state: token(6), item: 'after' },
    ]);
  });

  test('--follow goes on across a server that stops and answers 503 until it is back: the rows in between arrive once', async () => {
    const going = 'event: end\ndata: {"reason":"going_away"}\n\n';
    const stopping = (): Response =>
      json(
        {
          ok: false,
          error: {
            kind: 'unavailable',
            code: 'core.unavailable',
            message: 'The server is shutting down.',
            retryable: true,
            requestId: 'r',
          },
        },
        503,
      );
    const proxy = (): Response =>
      new Response('<html>bad gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      });
    const { fake, opened } = deployment([
      () => sse(welcome, head(1), item(2, 'one'), going),
      stopping,
      proxy,
      () => sse(welcome, item(3, 'two'), item(4, 'three'), end),
    ]);
    const run = await runCliWith(['call', 'auth.sessionEvents', '--follow'], fake.host);
    expect(run.code).toBe(0);
    expect(lines(run.stdout).map((line) => JSON.parse(line))).toEqual([
      { state: token(2), item: 'one' },
      { state: token(3), item: 'two' },
      { state: token(4), item: 'three' },
    ]);
    expect(opened).toEqual([
      { action: 'auth.sessionEvents' },
      { action: 'auth.sessionEvents', after: token(2) },
      { action: 'auth.sessionEvents', after: token(2) },
      { action: 'auth.sessionEvents', after: token(2) },
    ]);
  });

  test('an error event ends the command with the error of the wire', async () => {
    const failure =
      'event: error\ndata: {"kind":"forbidden","code":"auth.nope","message":"No.","retryable":false,"requestId":"r"}\n\n';
    const { fake } = deployment([() => sse(welcome, failure)]);
    const run = await runCliWith(['call', 'auth.sessionEvents', '--follow'], fake.host);
    expect(run.code).toBe(5);
    expect(run.stderr).toContain('auth.nope');
  });

  test('--follow opens the subscription three times in all before the first frame, then exits 10', async () => {
    const down = (): Response => {
      throw new Error('connection refused');
    };
    const { fake, opened } = deployment([down, down, down, down]);
    const run = await runCliWith(['call', 'auth.sessionEvents', '--follow'], fake.host);
    expect(run.code).toBe(10);
    expect(run.stderr).toContain('cli.unreachable');
    expect(opened).toHaveLength(3);
  });

  test('--follow reopens a stream the host refused with a rate limit after a frame, and goes on', async () => {
    const limited = (): Response =>
      json(
        {
          ok: false,
          error: {
            kind: 'rate_limited',
            code: 'core.quota_exceeded',
            message: 'Too many streams are open.',
            retryable: false,
            requestId: 'r',
          },
        },
        429,
      );
    const { fake, opened } = deployment([
      () => sse(welcome, head(1), item(2, 'one')),
      limited,
      limited,
      () => sse(welcome, item(3, 'two'), end),
    ]);
    const run = await runCliWith(['call', 'auth.sessionEvents', '--follow'], fake.host);
    expect(run.code).toBe(0);
    expect(lines(run.stdout).map((line) => JSON.parse(line))).toEqual([
      { state: token(2), item: 'one' },
      { state: token(3), item: 'two' },
    ]);
    expect(opened).toHaveLength(4);
  });

  test('a data event that is not JSON ends the command with an error instead of reopening for ever', async () => {
    const broken = 'id: x\nevent: data\ndata: not json\n\n';
    const { fake, opened } = deployment([() => sse(welcome, head(1), broken)]);
    const run = await runCliWith(['call', 'auth.sessionEvents', '--follow'], fake.host);
    // A ClientError of the stream parser reaches handleFailure as a rendered wire error, never as a bug.
    expect(run.code).toBe(
      exitCodeFor({
        kind: 'internal',
        code: 'core.internal',
        message: '',
        retryable: false,
        requestId: '',
      }),
    );
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('core.internal');
    expect(run.stderr).not.toMatch(/\n\s+at |\.ts:\d+|ClientError/);
    expect(opened).toHaveLength(1);
  });

  test('a deployment without the live module is core.live_unavailable (10)', async () => {
    const { fake } = deployment([
      () =>
        json(
          {
            ok: false,
            error: {
              kind: 'not_found',
              code: 'core.not_found',
              message: 'There is no such endpoint.',
              retryable: false,
              requestId: 'r',
            },
          },
          404,
        ),
    ]);
    const run = await runCliWith(['call', 'auth.sessionEvents', '--follow'], fake.host);
    expect(run.code).toBe(10);
    expect(run.stderr).toContain('core.live_unavailable');
    expect(fake.sent.some((sent) => sent.url.endsWith('/invoke'))).toBe(false);
  });

  test('Ctrl-C ends a followed subscription with 130', async () => {
    const hanging = (): Response =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`${welcome}${head(1)}`));
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    const { fake } = deployment([hanging]);
    const controller = new AbortController();
    const pending = runCliWith(
      ['call', 'auth.sessionEvents', '--follow'],
      fake.host,
      controller.signal,
    );
    // The stream is open once the request was sent.
    await expect.poll(() => fake.sent.some((sent) => sent.url.endsWith('/subscribe'))).toBe(true);
    controller.abort();
    expect((await pending).code).toBe(130);
  });

  test('--follow on anything but a subscription, and --async, --wait or --wait-effects on a subscription, are usage errors (2)', async () => {
    const { fake } = deployment([]);
    expect((await runCliWith(['call', 'app.health', '--follow'], fake.host)).code).toBe(2);
    for (const flag of ['--async', '--wait', '--wait-effects']) {
      const run = await runCliWith(['call', 'auth.sessionEvents', flag], fake.host);
      expect(run.code).toBe(2);
    }
    expect(fake.sent.some((sent) => sent.url.endsWith('/subscribe'))).toBe(false);
  });
});
