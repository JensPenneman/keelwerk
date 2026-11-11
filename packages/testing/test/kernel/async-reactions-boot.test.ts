import { consumers, reactionDispatcher } from '@keelwerk/events';
import { describe, expect, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { relayApp } from './support/relay-app.ts';

const unavailable = /asyncReactionsUnavailable: The reaction 'relay\./;

describe('the boot check of the asynchronous reactions', () => {
  test('a deployment without an event worker is refused, naming a reaction of the relay module', async () => {
    await expect(startTestRuntime(relayApp)).rejects.toThrow(unavailable);
  });

  test("an event worker whose runs lack 'asyncReactions' does not lift the refusal", async () => {
    const worker = consumers({ consumers: [reactionDispatcher()] });
    await expect(startTestRuntime(relayApp, { eventWorkers: [worker] })).rejects.toThrow(
      unavailable,
    );
  });

  test("a worker that runs 'asyncReactions' without the dispatcher cannot be built", () => {
    expect(() => consumers({ consumers: [], runs: ['asyncReactions'] })).toThrow(
      /no consumer is the reaction dispatcher/,
    );
  });
});
