import { describe, expect, test } from 'vitest';
import { confirmContract } from '../src/dev/confirm-contract.ts';
import { resultMarker } from '../src/dev/result-marker.ts';
import { startProbe } from '../src/dev/start-probe.ts';
import { createFakeHost } from './support/fake-host.ts';
import { probeOptions } from './support/probe-options.ts';
import { quietExit } from './support/quiet-exit.ts';
import { spawningChild } from './support/spawning-child.ts';

describe('the probe child', () => {
  test('reports the producers and the synchronisation it printed', async () => {
    const result = {
      producers: { written: ['a.ts'], notes: [], failures: [] },
      sync: { applied: [], deferred: [], warnings: [] },
    };
    const child = spawningChild(
      `noise\n\n${resultMarker} ${JSON.stringify(result)}\n`,
      '',
      quietExit,
    );
    const fake = createFakeHost({ spawn: child.spawn });
    expect(await startProbe(fake.host, probeOptions)).toEqual({ kind: 'done', result });
  });

  test('a failed probe says what the child printed, without the events', async () => {
    const child = spawningChild(
      '',
      '@keelwerk-event import - file:///p/a.ts\napp.ts could not be loaded\n',
      { code: 1, signal: null },
    );
    const fake = createFakeHost({ spawn: child.spawn });
    expect(await startProbe(fake.host, probeOptions)).toEqual({
      kind: 'failed',
      message: 'app.ts could not be loaded',
    });
  });
});

describe('the confirmation of contract steps', () => {
  test('is asked in a terminal and needs a yes', async () => {
    const asked: string[] = [];
    const fake = createFakeHost({ stdinInteractive: true, line: 'y' });
    const host = {
      ...fake.host,
      promptLine: async (label: string) => {
        asked.push(label);
        return 'y';
      },
    };
    expect(await confirmContract(host, ['main/shop: shop.core 0002'])).toBe(true);
    expect(asked[0]).toContain('main/shop: shop.core 0002');
    const declined = createFakeHost({ stdinInteractive: true, line: '' });
    expect(await confirmContract(declined.host, ['x'])).toBe(false);
  });

  test('is not asked without a terminal', async () => {
    const fake = createFakeHost({ stdinInteractive: false, line: 'y' });
    expect(await confirmContract(fake.host, ['x'])).toBe(false);
  });
});
