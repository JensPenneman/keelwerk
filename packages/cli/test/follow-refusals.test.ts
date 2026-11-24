import { describe, expect, test } from 'vitest';
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

describe('call <subscription> --follow against what a gate or proxy answers', () => {
  test('--follow ends with cli.bad_response when a gate answers 401 with a page after the first frame, instead of reopening for ever', async () => {
    const going = 'event: end\ndata: {"reason":"going_away"}\n\n';
    const gate = (): Response =>
      new Response('<html>sign in</html>', {
        status: 401,
        headers: { 'content-type': 'text/html' },
      });
    const { fake, opened } = deployment([() => sse(welcome, head(1), item(2, 'one'), going), gate]);
    const run = await runCliWith(['call', 'auth.sessionEvents', '--follow'], fake.host);
    expect(run.code).toBe(4);
    expect(run.stderr).toContain('cli.bad_response');
    expect(lines(run.stdout).map((line) => JSON.parse(line))).toEqual([
      { state: token(2), item: 'one' },
    ]);
    expect(opened).toHaveLength(2);
  });

  test('--follow ends when a gate answers 403 with JSON that has no error code, after a frame', async () => {
    const going = 'event: end\ndata: {"reason":"going_away"}\n\n';
    const gate = (): Response => json({ message: 'Forbidden by the gate.' }, 403);
    const { fake, opened } = deployment([() => sse(welcome, head(1), item(2, 'one'), going), gate]);
    const run = await runCliWith(['call', 'auth.sessionEvents', '--follow'], fake.host);
    expect(run.code).toBe(5);
    expect(run.stderr).toContain('cli.bad_response');
    expect(lines(run.stdout)).toHaveLength(1);
    expect(opened).toHaveLength(2);
  });

  test('--follow ends when the answer is 404 JSON without an error code, after a frame', async () => {
    const going = 'event: end\ndata: {"reason":"going_away"}\n\n';
    const missing = (): Response => json({ detail: 'nothing here' }, 404);
    const { fake, opened } = deployment([
      () => sse(welcome, head(1), item(2, 'one'), going),
      missing,
    ]);
    const run = await runCliWith(['call', 'auth.sessionEvents', '--follow'], fake.host);
    expect(run.code).toBe(6);
    expect(run.stderr).toContain('cli.bad_response');
    expect(lines(run.stdout)).toHaveLength(1);
    expect(opened).toHaveLength(2);
  });

  test('--follow ends when a gate redirects to a login page that answers 200 text/html', async () => {
    const going = 'event: end\ndata: {"reason":"going_away"}\n\n';
    const login = (): Response =>
      new Response('<html>sign in</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    const { fake, opened } = deployment([
      () => sse(welcome, head(1), item(2, 'one'), going),
      login,
      // The third open answers the end, so a follow that reopens ends the case on what it asserts.
      () => sse(welcome, end),
    ]);
    const run = await runCliWith(['call', 'auth.sessionEvents', '--follow'], fake.host);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('cli.bad_response');
    expect(lines(run.stdout)).toHaveLength(1);
    expect(opened).toHaveLength(2);
  });

  test('a gap frame is a note on standard error with the number of records missed, and the stream goes on', async () => {
    const gap = 'event: gap\ndata: {"missed":40}\n\n';
    const bare = 'event: gap\ndata: {}\n\n';
    const { fake, opened } = deployment([
      () => sse(welcome, head(1), item(2, 'one'), gap, item(3, 'two'), bare, end),
    ]);
    const run = await runCliWith(['call', 'auth.sessionEvents', '--follow'], fake.host);
    expect(run.code).toBe(0);
    expect(run.stderr).toBe('note: 40 records were missed\nnote: some records were missed\n');
    expect(lines(run.stdout).map((line) => JSON.parse(line))).toEqual([
      { state: token(2), item: 'one' },
      { state: token(3), item: 'two' },
    ]);
    expect(opened).toHaveLength(1);
  });
});
