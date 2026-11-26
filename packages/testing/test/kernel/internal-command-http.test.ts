import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  asIf,
  bootInternalApp,
  type InternalRuntime,
  ran,
  send,
} from './support/internal-command-kit.ts';

let runtime: InternalRuntime;
beforeAll(async () => {
  runtime = await bootInternalApp();
});
afterAll(() => runtime.stop());

const inputs = [{ n: 1 }, { n: 'x' }, undefined];

describe('an internal command through the http host answers as an unknown action', () => {
  test.each([false, true])(
    'POST /invoke: status, headers and body are word for word those of an unknown action (signed in: %s)',
    async (signedIn) => {
      for (const given of inputs) {
        const hidden = await send(
          runtime,
          '/_keelwerk/v1/invoke',
          { action: 'probe.sweep', input: given },
          signedIn,
        );
        const unknown = await send(
          runtime,
          '/_keelwerk/v1/invoke',
          { action: 'probe.nothing', input: given },
          signedIn,
        );
        expect(hidden.status).toBe(501);
        expect(asIf(hidden, 'probe.sweep', 'probe.nothing')).toEqual(unknown);
      }
      expect(ran).toEqual([]);
    },
  );

  test('POST /batch: the same, for each item', async () => {
    const items = (ref: string) => inputs.map((given) => ({ action: ref, input: given }));
    const hidden = await send(
      runtime,
      '/_keelwerk/v1/batch',
      { invocations: items('probe.sweep') },
      true,
    );
    const unknown = await send(
      runtime,
      '/_keelwerk/v1/batch',
      { invocations: items('probe.nothing') },
      true,
    );
    expect(hidden.body).toContain('core.not_implemented');
    expect(asIf(hidden, 'probe.sweep', 'probe.nothing')).toEqual(unknown);
    expect(ran).toEqual([]);
  });

  test('the surface does not list it and the REST route is gone, as for an unknown path', async () => {
    const surface = await send(runtime, '/_keelwerk/v1/surface', undefined, false);
    expect(surface.body).not.toContain('probe.sweep"');
    expect(surface.body).toContain('probe.sweepOpen');
    const hidden = await send(runtime, '/api/probe/sweep', { n: 1 }, true);
    const unknown = await send(runtime, '/api/probe/nothing', { n: 1 }, true);
    expect(hidden.status).toBe(404);
    expect(asIf(hidden, 'sweep', 'nothing')).toEqual(unknown);
    expect(ran).toEqual([]);
  });

  test('admission counts no request of it, as for an unknown action', async () => {
    // Every read of the usage is itself counted by the next one: that step is taken away.
    const countedBy = async (calls: () => Promise<unknown>) => {
      const first = await runtime.counted();
      const step = (await runtime.counted()) - first;
      await calls();
      return (await runtime.counted()) - first - 2 * step;
    };
    const callOf = (ref: string, given: unknown) => () =>
      send(runtime, '/_keelwerk/v1/invoke', { action: ref, input: given }, true);
    expect(await countedBy(callOf('probe.sweepOpen', { n: 2 }))).toBe(1);
    for (const given of inputs) {
      expect(await countedBy(callOf('probe.sweep', given))).toBe(0);
      expect(await countedBy(callOf('probe.nothing', given))).toBe(0);
    }
    ran.length = 0;
  });

  test('the control: the same command without the declaration runs for the signed-in user', async () => {
    const open = await send(
      runtime,
      '/_keelwerk/v1/invoke',
      { action: 'probe.sweepOpen', input: { n: 2 } },
      true,
    );
    expect(open.status).toBe(200);
    expect(ran).toContain('open:2');
    expect(ran.some((entry) => entry.startsWith('sweep:'))).toBe(false);
  });
});
