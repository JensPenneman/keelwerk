import { RetryableUnitError, uniqueConflict } from '@keelwerk/core';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import type { LoggedLine } from '../../src/harness/logged-line.ts';
import { recordingLogger } from '../../src/harness/recording-logger.ts';
import { bootReactions } from './support/reactions-kit.ts';
import { rejected } from './support/relay-base.ts';
import { relayControl } from './support/relay-control.ts';

const lines: LoggedLine[] = [];
const kit = await bootReactions({ logger: recordingLogger(lines) });
afterAll(() => kit.stop());
afterEach(() => {
  relayControl.crashPlan = undefined;
});

describe('an invoked command that fails inside', () => {
  test('answers the caller nothing of the failure, and the operator can find it in the caller log line', async () => {
    const answer = await kit.call('acme', 'relay.delegate', {});
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error).toMatchObject({ kind: 'internal', code: 'core.internal' });
    expect(JSON.stringify(answer)).not.toMatch(/crash detail|example\.com|relay\.crash/);
    const logged = lines.filter(
      (line) => line.level === 'error' && line.fields?.action === 'relay.delegate',
    );
    expect(logged).toHaveLength(1);
    const cause = logged[0]?.fields?.cause as Error;
    expect(cause.message).toBe('the invoked action "relay.crash" failed with core.internal');
  });

  test('a serialization failure inside the invoked command repeats the caller unit and the caller answers ok', async () => {
    let runs = 0;
    relayControl.crashPlan = () => {
      runs += 1;
      if (runs === 1) throw new RetryableUnitError('serialization_failure');
    };
    const answer = await kit.call('acme', 'relay.delegate', {});
    expect(answer.ok).toBe(true);
    expect(runs).toBe(2);
  });

  test('a unique conflict inside the invoked command repeats the caller unit, and the repeat answers the declared error', async () => {
    let runs = 0;
    relayControl.crashPlan = () => {
      runs += 1;
      if (runs === 1) throw uniqueConflict('relay_signal_key', new Error('duplicate key'));
      throw rejected();
    };
    const answer = await kit.call('acme', 'relay.delegate', {});
    expect(runs).toBe(2);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error).toMatchObject({ code: 'relay.forward_refused' });
  });
});
