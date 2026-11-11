import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { StreamFrame } from '../../src/conformance/transport/stream-frame.ts';
import { createTestDatabase } from '../support/create-test-database.ts';
import type { TestDatabase } from '../support/test-database.ts';
import { type Slice5Runtime, startSlice5Runtime } from './support/slice-5-runtime.ts';

const dueAt = '2027-01-01T00:00:00Z';
const lend = (runtime: Slice5Runtime, title: string) =>
  runtime.call<{ loanId: string }>('loans.lend', { bookTitle: title, dueAt }, 'ada');
const loanOf = (frame: StreamFrame): string => (frame.data as { loanId: string }).loanId;

/** Opens a pass for ada: the stream's credential, which a revocation can take away. */
async function passOf(runtime: Slice5Runtime): Promise<{ id: string; token: string }> {
  return runtime.call<{ id: string; token: string }>('passes.issue', { holder: 'ada' }, 'ada');
}

describe('slice 5: a live stream over SSE across restarts and revocations', () => {
  let urls: TestDatabase;
  const running: Slice5Runtime[] = [];

  beforeAll(async () => {
    urls = await createTestDatabase('slice_5_resume');
  }, 120_000);
  afterAll(async () => {
    await Promise.allSettled(running.splice(0).map((runtime) => runtime.stop(0)));
  });

  const start = async (options: Parameters<typeof startSlice5Runtime>[0]) => {
    const made = await startSlice5Runtime(options);
    running.push(made);
    return made;
  };

  test('a stream resumes after the process restarts with every change committed meanwhile', {
    timeout: 180_000,
  }, async () => {
    const first = await start({ urls, notify: true });
    const pass = await passOf(first);
    const stream = await first.follow(pass.token);
    expect(stream.response.status).toBe(200);
    await stream.until((frame) => frame.event === 'head');
    const committed: string[] = [];
    committed.push((await lend(first, 'A')).loanId);
    const seen: StreamFrame[] = [];
    const a = await stream.next();
    if (a === undefined) throw new Error('the stream ended before the first loan');
    seen.push(a);
    // One lend right before the stop: whether the stream saw it before the stop is not decided.
    committed.push((await lend(first, 'B')).loanId);
    const stopping = first.stop(5000);
    let ended = false;
    for (;;) {
      const frame = await stream.next();
      if (frame === undefined) break;
      if (frame.event === 'data') seen.push(frame);
      if (frame.event === 'end') {
        expect(frame.data).toEqual({ reason: 'going_away' });
        ended = true;
        break;
      }
    }
    await stopping;
    expect(ended).toBe(true);
    // The process is gone: a second one commits while nobody is connected.
    const away = await start({
      urls,
      notify: true,
      join: { backendId: first.backendId, tenantId: first.tenantId },
    });
    committed.push((await lend(away, 'C')).loanId);
    committed.push((await lend(away, 'D')).loanId);
    await away.stop(2000);
    const lastId = seen.at(-1)?.id;
    expect(lastId).toBeDefined();
    const restarted = await start({
      urls,
      notify: true,
      join: { backendId: first.backendId, tenantId: first.tenantId },
    });
    const resumed = await restarted.follow(pass.token, lastId);
    expect(resumed.response.status).toBe(200);
    const frames = await resumed.until((frame) => frame.event === 'head');
    const delivered = [...seen, ...frames.filter((frame) => frame.event === 'data')].map(loanOf);
    // Every change is there, none is missing; a duplicate may only be of the last item the client saw.
    expect(new Set(delivered)).toEqual(new Set(committed));
    const duplicated = delivered.filter((loan, index) => delivered.indexOf(loan) !== index);
    expect(duplicated.every((loan) => loan === loanOf(seen.at(-1) as StreamFrame))).toBe(true);
    await resumed.close();
  });

  test('a pass revoked from another request ends the stream unauthenticated within one second', {
    timeout: 120_000,
  }, async () => {
    const serving = await start({ urls, notify: true });
    const other = await start({
      urls,
      notify: true,
      join: { backendId: serving.backendId, tenantId: serving.tenantId },
    });
    const pass = await passOf(serving);
    const stream = await serving.follow(pass.token);
    await stream.until((frame) => frame.event === 'head');
    const revokedAt = Date.now();
    await other.call('passes.revoke', { id: pass.id }, 'ada');
    const frames = await stream.until(
      (frame) => frame.event === 'error' || frame.event === 'end',
      1000,
    );
    expect(Date.now() - revokedAt).toBeLessThan(1000);
    expect(frames.at(-1)).toMatchObject({ event: 'error', data: { kind: 'unauthenticated' } });
    await stream.close();
  });

  test('with notify off a revoked stream ends within two seconds', {
    timeout: 120_000,
  }, async () => {
    const serving = await start({ urls, notify: false });
    const other = await start({
      urls,
      notify: true,
      join: { backendId: serving.backendId, tenantId: serving.tenantId },
    });
    const pass = await passOf(serving);
    const stream = await serving.follow(pass.token);
    await stream.until((frame) => frame.event === 'head');
    const revokedAt = Date.now();
    await other.call('passes.revoke', { id: pass.id }, 'ada');
    const frames = await stream.until(
      (frame) => frame.event === 'error' || frame.event === 'end',
      2000,
    );
    expect(Date.now() - revokedAt).toBeLessThan(2000);
    expect(frames.at(-1)).toMatchObject({ event: 'error', data: { kind: 'unauthenticated' } });
    await stream.close();
  });
});
