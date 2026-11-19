import { defineApp } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import {
  freshName,
  startTestRuntime,
  startTransportRuntime,
  testPrincipal,
} from '@keelwerk/testing';
import { hooks, library, loans } from '@keelwerk/testing/fixtures';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test, vi } from 'vitest';
import type { CliHost } from '../src/context/cli-host.ts';
import { runCli } from '../src/run-cli.ts';
import { createFakeHost } from './support/fake-host.ts';
import { startPostEndpoint } from './support/post-endpoint.ts';
import { profilesPath } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';
import { newTap, type StreamTap, tapped } from './support/tap-stream.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const app = defineApp({ id: 'streams', modules: [live, library, loans] });
const runtime = await startTransportRuntime({ app, host: httpHost(), workers: true });
const hooksApp = defineApp({ id: 'hooks-live', modules: [live, hooks] });
const endpoint = await startPostEndpoint();
const hooksRuntime = await startTestRuntime(hooksApp, {
  tenants: ['acme'],
  adapter: 'memory',
  config: { hooks: { endpoint: endpoint.url, signingKey: 'hook-signing-key' } },
  workers: { queues: ['posts', 'commands'], egress: { allow: ['127.0.0.0/8'] } },
  host: httpHost(),
});
afterAll(async () => {
  await runtime.stop();
  await hooksRuntime.stop();
  await endpoint.close();
});

/** Where a CLI host's requests go: the deployment's `fetch`, its URL and the headers every request carries. */
interface Target {
  readonly url: string;
  readonly send: (request: Request) => Promise<Response>;
  readonly headers: Readonly<Record<string, string>>;
}
const streamsTarget: Target = {
  url: `https://${runtime.domains.acme ?? ''}`,
  send: (request) => runtime.fetch(request),
  headers: {},
};
const hooksTarget: Target = {
  url: 'https://hooks.example.test',
  send: (request) => hooksRuntime.fetch(request),
  headers: { 'x-tenant': hooksRuntime.tenants.acme.id },
};

/**
 * A CLI host whose requests go through the deployment's host as `subject`; ids are unique across
 * hosts. With a `tap` the subscription bodies are observed, and `cutFirst` breaks the first one.
 */
function hostFor(
  subject: string,
  target: Target = streamsTarget,
  tap?: { readonly tap: StreamTap; readonly cutFirst: boolean },
) {
  const fake = createFakeHost({
    files: {
      [profilesPath]: JSON.stringify({
        current: 'acme',
        profiles: { acme: { url: target.url } },
      }),
    },
    handler: async ({ url, request }) => {
      const subscribing = tap !== undefined && url.endsWith('/subscribe');
      if (subscribing) {
        tap.tap.bodies.push(request.body ?? '');
        // The reopen waits here, so a change made while the first stream is cut is the one it resumes with.
        if (tap.tap.bodies.length === 2) await tap.tap.gate;
        tap.tap.forwarded += 1;
      }
      const response = await target.send(
        new Request(url, {
          method: request.method,
          headers: {
            ...request.headers,
            ...target.headers,
            'x-test-principal': JSON.stringify(testPrincipal(subject)),
          },
          ...(request.body !== undefined && { body: request.body }),
          ...(request.signal !== undefined && { signal: request.signal }),
        }),
      );
      if (!subscribing) return response;
      return tapped(tap.tap, response, tap.cutFirst && tap.tap.bodies.length === 1);
    },
  });
  return { ...fake, host: { ...fake.host, newId: () => crypto.randomUUID() } };
}

const subjectOf = () => freshName('ada');
const lend = (title: string) => [
  'call',
  'loans.lend',
  '--book-title',
  title,
  '--due-at',
  '2026-12-01T00:00:00Z',
];

const lines = (out: readonly string[]): string[] =>
  out
    .join('')
    .split('\n')
    .filter((line) => line !== '');

/** Runs `call loans.loan.watch` until it printed `count` lines, then interrupts it as the user does. */
function watchLines(host: CliHost, count: number, extra: readonly string[] = []) {
  const controller = new AbortController();
  const out: string[] = [];
  const code = runCli(['call', 'loans.loan.watch', ...extra], {
    host,
    signal: controller.signal,
    process: {
      stdout: {
        write: (text: string) => {
          out.push(text);
          if (lines(out).length >= count) controller.abort();
          return true;
        },
      },
      stderr: { write: () => true },
      env: host.env,
    },
  });
  return { out, code };
}

describe('the CLI against a deployment with the live module and workers', () => {
  test('--async --wait prints the value of the command once a worker completed it', async () => {
    const run = await runCliWith(
      [...lend(freshName('Dune')), '--async', '--wait', '--output', 'json'],
      hostFor(subjectOf()).host,
    );
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ loanId: expect.stringMatching(/^loan_/) });
  });

  test('a lend the worker refuses prints loans.already_lent and exits non-zero', async () => {
    const title = freshName('Emma');
    const host = hostFor(subjectOf()).host;
    expect((await runCliWith([...lend(title), '--output', 'json'], host)).code).toBe(0);
    const again = await runCliWith([...lend(title), '--async', '--wait', '--output', 'json'], host);
    expect(again.code).toBe(7);
    expect(again.stderr).toContain('loans.already_lent');
  });

  test('a subscription stops at head without --follow', async () => {
    const run = await runCliWith(['call', 'loans.loanEvents'], hostFor(subjectOf()).host);
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
  });

  test('call hooks.notify --wait-effects waits for the worker that delivers the hook', async () => {
    const run = await runCliWith(
      ['call', 'hooks.notify', '--payload', '{"hello":"world"}', '--wait-effects=30'],
      hostFor(subjectOf(), hooksTarget).host,
    );
    expect(run.code).toBe(0);
    expect(run.stderr).toMatch(/effect eff_[0-9a-z]+ hooks\.post succeeded/);
    expect(endpoint.received()).toBeGreaterThanOrEqual(1);
  });

  test('the generated watch follows and prints a line for each row, until the user interrupts', async () => {
    const subject = subjectOf();
    const tap = newTap();
    const watcher = hostFor(subject, streamsTarget, { tap, cutFirst: false });
    const writer = hostFor(subject).host;
    const watching = watchLines(watcher.host, 1);
    // A change counts once the watch is past its head.
    await expect.poll(() => tap.headSeen, { timeout: 60_000 }).toBe(true);
    await runCliWith(lend(freshName('Hamlet')), writer);
    expect(await watching.code).toBe(130);
    expect(watching.out.join('')).toContain('"item"');
  });

  test('--follow resumes from the last token across a dropped connection and prints each loan once', async () => {
    const subject = subjectOf();
    const tap = newTap();
    const watcher = hostFor(subject, streamsTarget, { tap, cutFirst: true });
    const writer = hostFor(subject).host;
    const watching = watchLines(watcher.host, 2, ['--follow']);
    await expect.poll(() => tap.headSeen, { timeout: 60_000 }).toBe(true);
    await runCliWith(lend(freshName('Ulysses')), writer);
    // The first stream breaks after its first data event; this loan is lent while it is cut.
    await expect.poll(() => tap.cut, { timeout: 60_000 }).toBe(true);
    // The reopen has reached the host and waits at the gate: the next loan is lent while it is disconnected.
    await expect.poll(() => tap.bodies.length, { timeout: 60_000 }).toBe(2);
    expect((await runCliWith(lend(freshName('Emma')), writer)).code).toBe(0);
    expect(tap.forwarded).toBe(1);
    tap.release();
    expect(await watching.code).toBe(130);
    const rows = lines(watching.out).map(
      (line) => JSON.parse(line) as { state: string; item: unknown },
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => JSON.stringify(row.item))).size).toBe(2);
    expect(new Set(rows.map((row) => row.state)).size).toBe(2);
    expect(tap.bodies.length).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(tap.bodies[0] ?? '{}')).not.toHaveProperty('after');
    expect(JSON.parse(tap.bodies[1] ?? '{}')).toHaveProperty('after', rows[0]?.state);
  });
});
