import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { checkBroadcastChannel } from './check-broadcast-channel.ts';

const limit = 8_000;
const encoder = new TextEncoder();

/**
 * The notification text of one broadcast (14.3.2, 15.4.7): the channel, `\n`, the payload in
 * base64 with padding. Throws what `checkBroadcastChannel` throws, and `KeelwerkError`
 * `validation` `core.payload_too_large` ("The broadcast on <channel> is <n> bytes; a notification
 * holds fewer than 8,000.", details `{ channel, bytes, limit: 8000 }`) for a text of 8,000 UTF-8
 * bytes or more. The size is computed before the payload is encoded: the channel's UTF-8 bytes, the
 * newline and 4 * ceil(length / 3) base64 characters. Every adapter computes the same text (WP-179
 * checks topic sizes with it).
 */
export function broadcastNotification(channel: string, payload: Uint8Array): string {
  checkBroadcastChannel(channel);
  const bytes = encoder.encode(channel).length + 1 + 4 * Math.ceil(payload.length / 3);
  if (bytes >= limit) {
    throw new KeelwerkError({
      kind: 'validation',
      code: 'core.payload_too_large',
      message: `The broadcast on ${channel} is ${bytes.toLocaleString('en-US')} bytes; a notification holds fewer than ${limit.toLocaleString('en-US')}.`,
      details: { channel, bytes, limit },
    });
  }
  return `${channel}\n${btoa(Array.from(payload, (byte) => String.fromCharCode(byte)).join(''))}`;
}
