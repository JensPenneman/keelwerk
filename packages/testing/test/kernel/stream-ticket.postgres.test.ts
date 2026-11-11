import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import type { TestDatabase } from '../support/test-database.ts';
import { type Slice5Runtime, startSlice5Runtime } from './support/slice-5-runtime.ts';

describe('a stream ticket on PostgreSQL', () => {
  let urls: TestDatabase;
  let runtime: Slice5Runtime;

  beforeAll(async () => {
    urls = await createTestDatabase('stream_ticket');
    runtime = await startSlice5Runtime({ urls, notify: true });
  }, 120_000);
  afterAll(async () => {
    await runtime?.stop(0);
  });

  test('two requests with one ticket at once give one stream and one 401', {
    timeout: 120_000,
  }, async () => {
    const answer = await runtime.call<{ ticket: string }>('live.ticket', {}, 'ada');
    const open = () =>
      runtime.fetch(
        new Request(
          `https://slice5.example.test/_keelwerk/v1/subscribe?action=loans.loanEvents&input=%7B%7D&ticket=${answer.ticket}`,
          { headers: { 'x-tenant': runtime.tenantId } },
        ),
      );
    const answers = await Promise.all([open(), open()]);
    const statuses = answers.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 401]);
    const refused = answers.find((response) => response.status === 401);
    if (refused === undefined) throw new Error('no request was refused');
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'core.ticket_invalid',
    );
    for (const response of answers) await response.body?.cancel().catch(() => undefined);
  });
});
