import { defineApp } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import { testPrincipal } from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import type { RetryPolicy } from '../../../src/retry-policy.ts';

/** The fixture app with the live module: `loans.loanEvents` and the generated `loans.loan.watch` exist with it. */
export const liveStreamsApp = defineApp({ id: 'streams', modules: [live, library, loans] });

/** Retries that wait for nothing: the tests of resuming never sleep. */
export const fastRetry: Partial<RetryPolicy> = {
  retries: 3,
  baseDelayMs: 1,
  maxDelayMs: 5,
  random: () => 0.5,
};

export const due = Temporal.Instant.from('2026-12-01T00:00:00Z');

/** The headers the runtime's principal resolver reads for `subject`. */
export function principalHeaders(subject: string): Record<string, string> {
  return { 'x-test-principal': JSON.stringify(testPrincipal(subject)) };
}

/** A `fetch` that adds `headers` to every request and sends it on through `send`. */
export function withHeaders(
  send: (request: Request) => Promise<Response>,
  headers: Record<string, string>,
): typeof fetch {
  return (input, init) => {
    const request = new Request(input, init);
    for (const [name, value] of Object.entries(headers)) request.headers.set(name, value);
    return send(request);
  };
}
