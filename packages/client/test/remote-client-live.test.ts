import { startTransportRuntime, testPrincipal } from '@keelwerk/testing';
import type { TransportApp } from '@keelwerk/testing/fixtures';
import { transportApp } from '@keelwerk/testing/fixtures';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, it } from 'vitest';
import { createRemoteClient } from '../src/index.ts';

const runtime = await startTransportRuntime({ app: transportApp, host: httpHost() });
afterAll(() => runtime.stop());

const domain = runtime.domains.acme ?? '';
const due = Temporal.Instant.from('2026-12-01T00:00:00Z');
const principal = JSON.stringify(testPrincipal('ada'));

function clientFor(subject = principal) {
  return createRemoteClient<TransportApp>({
    url: `https://${domain}`,
    apiVersion: '2026-11-04',
    fetch: (input, init) => {
      const request = new Request(input, init);
      request.headers.set('x-test-principal', subject);
      return runtime.fetch(request);
    },
  });
}

describe('the remote client against the running host', () => {
  it('reads the surface the host serves for the app at its head', async () => {
    const surface = await clientFor().surface();
    expect(surface.app).toBe('transport');
    expect(surface.apiVersion).toBe('2026-11-04');
    expect(surface.actions.some((action) => action.ref === 'loans.lend')).toBe(true);
  });

  it('invokes a command and reads the row it wrote, with the types of the app', async () => {
    const client = clientFor();
    const title = `Dune-${crypto.randomUUID().slice(0, 8)}`;
    const lent = await client.invoke('loans.lend', {
      bookTitle: title,
      dueAt: due,
    });
    expect(lent.loanId).toMatch(/^[0-9a-f-]{36}$/);
    const page = await client.invoke('loans.loan.query', {});
    expect(page.items.map((row) => row.bookTitle)).toContain(title);
  });

  it('answers a declared error as the error the app declared', async () => {
    const client = clientFor();
    const input = {
      bookTitle: `Emma-${crypto.randomUUID().slice(0, 8)}`,
      dueAt: due,
    };
    await client.invoke('loans.lend', input);
    const again = await client.attempt('loans.lend', input);
    expect(again.ok).toBe(false);
    if (!again.ok)
      expect(again.error).toMatchObject({ kind: 'conflict', code: 'loans.already_lent' });
  });

  it('asks for async and gets the receipt the host recorded', async () => {
    const receipt = await clientFor().invoke(
      'loans.lend',
      { bookTitle: `Ulysses-${crypto.randomUUID().slice(0, 8)}`, dueAt: due },
      { prefer: 'async' },
    );
    expect(receipt).toMatchObject({ status: 'accepted' });
  });

  it('is unauthenticated without a principal, and waiting for effects is refused in M1', async () => {
    const anonymous = await clientFor(JSON.stringify(testPrincipal(null))).attempt('loans.lend', {
      bookTitle: 'x',
      dueAt: due,
    });
    expect(anonymous.ok).toBe(false);
    if (!anonymous.ok) expect(anonymous.error).toMatchObject({ kind: 'unauthenticated' });
    await expect(clientFor().waitForEffects(['effect'])).rejects.toMatchObject({
      code: 'core.live_unavailable',
    });
  });
});
