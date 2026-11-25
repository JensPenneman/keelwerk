import { describe, expect, test } from 'vitest';
import { endProcess } from '../../src/bin/end-process.ts';

/** A stream whose write callback the case fires itself, and a log of what happened in order. */
function stubs() {
  const events: string[] = [];
  const callbacks: (() => void)[] = [];
  const stream = (name: string) => ({
    write: (_text: string, callback: () => void): boolean => {
      events.push(`write ${name}`);
      callbacks.push(() => {
        events.push(`written ${name}`);
        callback();
      });
      return true;
    },
  });
  return {
    events,
    callbacks,
    streams: [stream('stdout'), stream('stderr')],
    exit: (code: number) => {
      events.push(`exit ${code}`);
    },
  };
}

describe('the end of the process', () => {
  test('a command returns with a handle left open, which the stub does not close: exit is called with its code, once both streams have been written out and not before', async () => {
    const { events, callbacks, streams, exit } = stubs();
    const ending = endProcess(async () => 3, { streams, exit });
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['write stdout', 'write stderr']);
    callbacks[0]?.();
    await Promise.resolve();
    expect(events).not.toContain('exit 3');
    callbacks[1]?.();
    await ending;
    expect(events).toEqual([
      'write stdout',
      'write stderr',
      'written stdout',
      'written stderr',
      'exit 3',
    ]);
  });

  test('the code is the command’s, whatever it is', async () => {
    const { callbacks, streams, exit, events } = stubs();
    const ending = endProcess(async () => 130, { streams, exit });
    await Promise.resolve();
    await Promise.resolve();
    for (const fire of callbacks) fire();
    await ending;
    expect(events.at(-1)).toBe('exit 130');
  });
});
