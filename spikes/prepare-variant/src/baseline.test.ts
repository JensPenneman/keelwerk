import { createLocalClient, testPrincipal } from '@keelwerk/testing';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SpikeWorld } from './start-spike-world.ts';
import { startSpikeWorld } from './start-spike-world.ts';

let world: SpikeWorld;
beforeAll(async () => {
  world = await startSpikeWorld();
});
afterAll(() => world.runtime.stop());

describe('the merged kernel before the variant', () => {
  test('the spike app composes without problems and lists the effect', () => {
    const problems = world.registry.problems.filter((problem) => problem.severity === 'error');
    expect(problems).toEqual([]);
    expect(world.registry.effects.get('github.exchangeCode')).toMatchObject({
      performer: 'executor',
      executor: null,
    });
    expect(world.registry.actions.get('github.connect')?.prepare).toBeTypeOf('function');
    expect(world.registry.actions.get('github.connectInline')?.prepare).toBeUndefined();
  });

  test('the harness client runs the commands that perform nothing', async () => {
    const ada = createLocalClient(world.runtime, { principal: testPrincipal('ada') });
    const device = await ada.invoke('trail.registerDevice', { name: 'phone' });
    expect(device.deviceId).toEqual(expect.any(String));
  });

  test('the harness client cannot run the separate form: the pipeline refuses prepare, the write path refuses perform', async () => {
    const ada = createLocalClient(world.runtime, { principal: testPrincipal('ada') });
    await ada.invoke('github.startConnect', { state: 'baseline' });
    const attempt = await ada.attempt('github.connect', { code: 'good-1', state: 'baseline' });
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) {
      // WP-41 runs prepare; this then becomes core.request_not_allowed from the write path.
      expect(attempt.error.code).toBe('core.not_implemented');
    }
  });

  test('the harness client cannot run the inline form either: decide has no perform', async () => {
    const ada = createLocalClient(world.runtime, { principal: testPrincipal('ada') });
    const attempt = await ada.attempt('github.connectInline', {
      code: 'good-2',
      state: 'baseline',
    });
    expect(attempt.ok).toBe(false);
  });
});
