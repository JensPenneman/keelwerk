import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sources(): string[] {
  const output = execFileSync('git', ['ls-files', '-z', '--', 'packages/transport-*/src/*.ts'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  return output.split('\0').filter((path) => path !== '' && !/\.test(-d)?\.ts$/.test(path));
}

const read = (path: string): string => readFileSync(join(repositoryRoot, path), 'utf8');

// A socket holds the session it was opened with, and a session that no longer holds (a logout, a
// deactivated profile) must start nothing on it: each path that starts a stream reads that session
// only after the host's session check (architecture.md, 16.3.4). A request opens a session of its own.
const startsStreams = new Map<string, 'socket' | 'request'>([
  ['packages/transport-http/src/start-socket-subscription.ts', 'socket'],
  ['packages/transport-graphql/src/subscriptions/subscribe-resolver.ts', 'socket'],
  ['packages/transport-trpc/src/router/subscribe-procedure.ts', 'socket'],
  ['packages/transport-http/src/subscribe-endpoint.ts', 'request'],
  ['packages/transport-orpc/src/router/subscribe-procedure.ts', 'request'],
  ['packages/transport-rest/src/subscriptions/serve-subscription.ts', 'request'],
]);

test('every source that starts a stream is listed, and a socket path is told which check it meets', () => {
  const all = sources();
  expect(all.length).toBeGreaterThan(100);
  const found = all.filter((path) => /\binvoker\.subscribe\b/.test(read(path)));
  expect(found.sort()).toEqual([...startsStreams.keys()].sort());
});

test('a path that starts a subscription on a socket reads the session it holds only after the check', () => {
  // The live socket: the session comes from `checkedSocketSession`, never from the socket's state.
  const live = read('packages/transport-http/src/start-socket-subscription.ts');
  expect(live).toContain('await checkedSocketSession(state, ');
  expect(live).not.toMatch(/\bstate\.session\b/);
  // GraphQL over a socket: `connection.check()` runs before the first read of `connection.session()`.
  const graphql = read('packages/transport-graphql/src/subscriptions/graphql-ws-handler.ts');
  const reads = [...graphql.matchAll(/\bconnection\.session\(\)/g)].map((m) => m.index);
  const onSubscribe = graphql.indexOf('onSubscribe:');
  expect(graphql.indexOf('await connection.check()', onSubscribe)).toBeGreaterThan(onSubscribe);
  for (const at of reads.filter((index) => index > onSubscribe)) {
    expect(at).toBeGreaterThan(graphql.indexOf('await connection.check()', onSubscribe));
  }
  // tRPC over a socket: the context reads the held session per call, and each procedure admits first.
  for (const path of [
    'packages/transport-trpc/src/router/subscribe-procedure.ts',
    'packages/transport-trpc/src/router/invoke-procedure.ts',
  ]) {
    expect(read(path)).toContain('await admitSocketCall(');
  }
  expect(read('packages/transport-trpc/src/socket/admit-socket-call.ts')).toContain(
    'await socket.check()',
  );
});

// The raw reads of the session a socket holds, by file and exact number, for each kind of socket. A file that is
// not listed reads none; a new read, or one moved to another file, changes a number and fails here: the
// reader is then looked at (does it start work? then it meets the check first) and the list is changed with it.
function reads(paths: readonly string[], form: RegExp): Record<string, number> {
  const found: Record<string, number> = {};
  for (const path of paths) {
    const count = [...read(path).matchAll(form)].length;
    if (count > 0) found[path] = count;
  }
  return found;
}

test('the sources that read the session a live socket holds are these, so a new reader is looked at', () => {
  const live = sources().filter(
    (path) => path.startsWith('packages/transport-http/') && read(path).includes('LiveSocketState'),
  );
  expect(reads(live, /\bstate\.session\b|\{[^}]*\bsession\b[^}]*\}\s*=\s*state\b/g)).toEqual({
    'packages/transport-http/src/checked-socket-session.ts': 1,
    'packages/transport-http/src/invoke-over-socket.ts': 1,
    'packages/transport-http/src/keep-socket-session.ts': 7,
    'packages/transport-http/src/open-socket-session.ts': 3,
    'packages/transport-http/src/send-welcome.ts': 2,
    'packages/transport-http/src/socket-session-of.ts': 5,
    'packages/transport-http/src/socket-wire-error.ts': 1,
  });
});

test('the sources that read the session a tRPC socket context holds are these', () => {
  const trpc = sources().filter((path) => path.startsWith('packages/transport-trpc/'));
  expect(reads(trpc, /\b(?:ctx|context)\.session\b|\bconnection\.session\(\)/g)).toEqual({
    'packages/transport-trpc/src/mount/create-trpc-handler.ts': 3,
    'packages/transport-trpc/src/router/build-trpc-router.ts': 1,
    'packages/transport-trpc/src/router/invoke-procedure.ts': 2,
    'packages/transport-trpc/src/router/subscribe-procedure.ts': 1,
    'packages/transport-trpc/src/socket/trpc-socket-context.ts': 1,
    'packages/transport-trpc/src/socket/trpc-ws-handler.ts': 4,
  });
});

test('the sources that read the session a GraphQL socket connection holds are these', () => {
  const graphql = sources().filter((path) => path.startsWith('packages/transport-graphql/'));
  expect(reads(graphql, /\b(?:connection|socket)\.session\(\)/g)).toEqual({
    'packages/transport-graphql/src/subscriptions/graphql-ws-handler.ts': 3,
  });
});
