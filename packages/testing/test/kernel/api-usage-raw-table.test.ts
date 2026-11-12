import type { Carrier, Clock } from '@keelwerk/core';
import { defineApiVersions, defineApp } from '@keelwerk/core';
import type { PgliteAdapter } from '@keelwerk/data/pglite';
import { httpHost } from '@keelwerk/transport-http';
import { expect, test } from 'vitest';
import { findPlaintext } from '../../src/dump/find-plaintext.ts';
import { library } from '../../src/fixtures/index.ts';
import { pinnedLiveTimers } from '../../src/harness/pinned-live-timers.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { testPrincipalHeader } from '../../src/harness/test-principal-header.ts';

const app = defineApp({
  id: 'counting',
  modules: [library],
  api: defineApiVersions({ '2026-11-04': {}, '2026-11-11': {} }),
});

const address = '203.0.113.77';
const userAgent = 'raw-table-probe/9.1';
const subject = 'ada-raw-marker';
const sessionId = 'sess-raw-marker-4711';
const operator: Carrier = { transport: 'test', local: { inProcess: true } };

test('the kw_api_usage table of the database holds no address, principal id, session id or user agent', {
  timeout: 120_000,
}, async () => {
  let now = Temporal.Instant.from('2026-11-12T10:00:00Z');
  const clock: Clock = { now: () => now };
  const timers = pinnedLiveTimers(clock);
  const runtime = await startTestRuntime(app, {
    adapter: 'pglite',
    operators: true,
    clock,
    timers,
    host: httpHost(),
    tenants: ['acme'],
  });
  try {
    const signedIn = testPrincipal(subject, { claims: { sid: sessionId } });
    for (let request = 0; request < 3; request += 1) {
      const response = await runtime.fetch(
        new Request('https://counting.example.test/_keelwerk/v1/invoke', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': userAgent,
            'x-tenant': runtime.tenants.acme.id,
            [testPrincipalHeader]: JSON.stringify(signedIn),
          },
          body: JSON.stringify({ action: 'library.findByIsbn', input: { isbn: '978-0' } }),
        }),
        { remoteAddress: address },
      );
      expect(response.status).toBe(200);
    }
    // The counts are flushed by the first wait the clock has passed.
    now = now.add({ seconds: 61 });
    const counted = async (): Promise<number> => {
      const outcome = await runtime.invoker.invoke<
        unknown,
        { items: readonly { count: number }[] }
      >({
        action: 'core.apiUsage',
        input: { since: '2026-11-01', until: '2026-12-31' },
        carrier: operator,
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
      });
      if (!outcome.ok) throw outcome.error;
      return outcome.value.items.reduce((sum, row) => sum + Number(row.count), 0);
    };
    await expect
      .poll(
        async () => {
          await timers.fire();
          return counted();
        },
        { timeout: 60_000 },
      )
      .toBe(3);
    const control = runtime.control.adapter as unknown as PgliteAdapter;
    const stored = await control.asOwner(async (database) => {
      const [table] = (
        await database.query<{ schemaname: string }>(
          `select schemaname from pg_tables where tablename = 'kw_api_usage'`,
        )
      ).rows;
      const rows = await database.query<{ row: string }>(
        `select t::text as row from "${table?.schemaname ?? ''}".kw_api_usage t`,
      );
      return rows.rows.map((row) => row.row);
    });
    expect(stored).toHaveLength(1);
    const text = stored.join('\n');
    // The search sees what the row does hold: the scope the requests were counted under.
    const tenantId = runtime.tenants.acme.id;
    expect(findPlaintext(text, [tenantId])).toEqual([tenantId]);
    expect(findPlaintext(text, [address, subject, sessionId, userAgent])).toEqual([]);
  } finally {
    await runtime.stop();
  }
});
