import type { TestApp } from '@keelwerk/testing';
import { afterEach, expect } from 'vitest';
import { type StreamRuntime, startStreamRuntime } from './stream-runtime.ts';

const start = Temporal.Instant.from('2026-11-11T12:00:00Z');

const principalHeader = (subject: string) => ({
  'x-test-principal': JSON.stringify({ subject, roles: [], claims: {} }),
});

/** A clock the test moves. */
export interface AdvancingClock {
  readonly clock: { now(): Temporal.Instant };
  advance(seconds: number): Temporal.Instant;
}

/** A clock that starts on a fixed day and moves only when the test says so. */
export function advancingClock(): AdvancingClock {
  let at = start;
  return { clock: { now: () => at }, advance: (seconds: number) => (at = at.add({ seconds })) };
}

/** A started stream deployment with the two calls of the ticket tests: issue a ticket, open the subscription with one. */
export interface TicketKit extends StreamRuntime {
  issue(subject: string, action?: string): Promise<string>;
  open(ticket: string, headers?: Record<string, string>, action?: string): Promise<Response>;
  readonly clock: AdvancingClock;
}

/**
 * Registers the cleanup of the test file and returns `boot`, which starts a stream deployment on the
 * adapter named; `closers` collects what the test has to close before the deployments stop.
 */
export function useTicketKit(): {
  boot(adapter: 'memory' | 'pglite', clock?: AdvancingClock, app?: TestApp): Promise<TicketKit>;
  closers: (() => Promise<void>)[];
} {
  const running: StreamRuntime[] = [];
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
    await Promise.all(running.splice(0).map((started) => started.runtime.stop()));
  });
  return {
    closers,
    async boot(adapter, clock = advancingClock(), app) {
      const made = await startStreamRuntime(
        {},
        { pglite: adapter === 'pglite', clock: clock.clock, ...(app !== undefined && { app }) },
      );
      running.push(made);
      const issue = async (subject: string, action?: string): Promise<string> => {
        const response = await made.target.fetch(
          new Request(`${made.origin}/_keelwerk/v1/invoke`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...principalHeader(subject) },
            body: JSON.stringify({
              action: 'live.ticket',
              input: action === undefined ? {} : { action },
            }),
          }),
        );
        const body = (await response.json()) as { ok: boolean; value: { ticket: string } };
        expect(body.ok).toBe(true);
        return body.value.ticket;
      };
      const open = (
        ticket: string,
        headers: Record<string, string> = {},
        action = 'loans.loanEvents',
      ) =>
        made.target.fetch(
          new Request(
            `${made.origin}/_keelwerk/v1/subscribe?action=${action}&input=%7B%7D&ticket=${ticket}`,
            { headers },
          ),
        );
      return { ...made, issue, open, clock };
    },
  };
}
