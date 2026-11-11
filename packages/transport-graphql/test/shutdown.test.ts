import { getEventListeners } from 'node:events';
import { describe, expect, test } from 'vitest';
import { ask, mountedGraphql, transportSurface } from './support/graphql-kit.ts';
import { rowPage } from './support/rows.ts';

const surface = transportSurface();

describe('shutdown', () => {
  test('after close starts a request answers unavailable and close waits for requests in flight', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mounted = await mountedGraphql(surface, async () => {
      await gate;
      return { ok: true, value: rowPage([]) };
    });
    const running = ask(mounted.handler, '{ loansLoans { nodes { id } } }');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const closing = mounted.close();
    const late = await ask(mounted.handler, '{ __typename }');
    expect(late.status).toBe(503);
    expect(late.headers.get('retry-after')).toBe('1');
    expect(late.body.errors[0].extensions.code).toBe('UNAVAILABLE');
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(false);
    release?.();
    await closing;
    expect((await running).status).toBe(200);
  });
});

describe('the deadline of close', () => {
  test('close leaves no listener on a deadline that never fires', async () => {
    const mounted = await mountedGraphql(surface, () => ({ ok: true, value: undefined }));
    const deadline = new AbortController();
    await mounted.close(deadline.signal);
    expect(getEventListeners(deadline.signal, 'abort')).toHaveLength(0);
    expect(deadline.signal.aborted).toBe(false);
  });
});
