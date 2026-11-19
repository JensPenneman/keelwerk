import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { durablePgliteFactory, freshName, startTestRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRemoteClient } from '../../src/index.ts';
import type { LiveApp } from '../live-app.ts';
import {
  due,
  fastRetry,
  liveStreamsApp,
  principalHeaders,
  withHeaders,
} from './support/live-fixtures.ts';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((step) => step()));
});

describe('the client against a server that restarts', () => {
  it('client.subscribe survives a server restart: the loans committed while it was down arrive once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kw-restart-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const external = () => ({
      factory: durablePgliteFactory({ dataDirOf: (placement) => join(root, placement.id) }),
      url: 'pglite:durable',
    });
    const first = await startTestRuntime(liveStreamsApp, {
      tenants: ['acme'],
      external: external(),
      host: httpHost(),
    });
    let stopped = false;
    cleanup.push(async () => {
      if (!stopped) await first.stop();
    });
    const tenant = first.tenants.acme.id;
    const headers = { ...principalHeaders('ada'), 'x-tenant': tenant };
    let current = first;
    let down = false;
    const client = createRemoteClient<LiveApp>({
      url: 'https://streams.example.test',
      apiVersion: first.head,
      fetch: withHeaders(
        (request) =>
          down ? Promise.reject(new TypeError('fetch failed')) : current.fetch(request),
        headers,
      ),
      retry: fastRetry,
    });
    const frames = client.subscribe('loans.loanEvents', {})[Symbol.asyncIterator]();
    try {
      expect((await frames.next()).value).toMatchObject({ control: 'head' });
      down = true;
      await first.stop();
      stopped = true;
      const second = await startTestRuntime(liveStreamsApp, {
        tenants: ['acme'],
        external: external(),
        join: { backendId: first.backendId, tenants: { acme: tenant } },
        host: httpHost(),
      });
      cleanup.push(() => second.stop());
      const writer = createRemoteClient<LiveApp>({
        url: 'https://streams.example.test',
        apiVersion: second.head,
        fetch: withHeaders((request) => second.fetch(request), headers),
        retry: fastRetry,
      });
      const lent = [freshName('Dune'), freshName('Emma')];
      for (const bookTitle of lent) await writer.invoke('loans.lend', { bookTitle, dueAt: due });
      current = second;
      down = false;
      const seen: string[] = [];
      while (seen.length < 2) {
        const step = await frames.next();
        if (step.done === true) break;
        if (!('control' in step.value)) seen.push(step.value.event.loanId);
      }
      expect(new Set(seen).size).toBe(2);
      // Nothing arrives twice: the next change is the next loan, not a repeat.
      await writer.invoke('loans.lend', { bookTitle: freshName('Hamlet'), dueAt: due });
      let next: string | undefined;
      while (next === undefined) {
        const step = await frames.next();
        if (step.done === true) break;
        if (!('control' in step.value)) next = step.value.event.loanId;
      }
      expect(next).not.toBeUndefined();
      expect(seen).not.toContain(next);
    } finally {
      await frames.return?.();
    }
  });
});
