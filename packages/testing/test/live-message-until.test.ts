import type { LiveServerMessage } from '@keelwerk/core';
import { describe, expect, it } from 'vitest';
import { liveMessageUntil } from '../src/conformance/transport/live-message-until.ts';
import type { TestSocket } from '../src/conformance/transport/test-socket.ts';

/** A socket that answers `next` with the given frames in order, then fails like a silent one. */
function socketOf(frames: readonly unknown[]): TestSocket {
  const queue = [...frames];
  return {
    send: () => undefined,
    next: () => {
      const frame = queue.shift();
      if (frame === undefined) return Promise.reject(new Error('No message within 10000 ms.'));
      return Promise.resolve(JSON.stringify(frame));
    },
    closed: new Promise(() => undefined),
    close: () => Promise.resolve(),
  };
}

const welcome = (message: LiveServerMessage): boolean => message.type === 'welcome';

describe('liveMessageUntil', () => {
  it('skips notices and returns the first frame that satisfies the test', async () => {
    const socket = socketOf([
      { type: 'notice', notice: { kind: 'deprecation', action: 'loans.oldLend' } },
      { type: 'welcome' },
    ]);
    expect((await liveMessageUntil(socket, welcome)).type).toBe('welcome');
  });

  it('fails at a frame that is not a notice and does not match, naming the frames seen', async () => {
    const socket = socketOf([
      { type: 'notice', notice: { kind: 'deprecation', action: 'loans.oldLend' } },
      { type: 'error', error: { code: 'core.invalid' } },
      { type: 'welcome' },
    ]);
    await expect(liveMessageUntil(socket, welcome)).rejects.toThrow(
      /unexpected frame.*loans\.oldLend.*core\.invalid/,
    );
  });

  it('names the notices seen when nothing else arrives', async () => {
    const socket = socketOf([
      { type: 'notice', notice: { kind: 'deprecation', action: 'loans.oldLend' } },
    ]);
    await expect(liveMessageUntil(socket, welcome)).rejects.toThrow(
      /No message within 10000 ms\. Frames seen: .*loans\.oldLend/,
    );
  });
});
