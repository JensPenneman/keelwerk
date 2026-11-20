import { errors } from '../errors/errors.ts';

/**
 * `validation` (`core.validation`) unless the channel is 1 to 200 UTF-16 code units of well-formed
 * text with no newline and no U+0000. The unit is `channel.length`, so a channel of 101 emoji (202
 * code units) is refused; receivers apply the same check, so the unit is part of the wire format.
 */
export function checkBroadcastChannel(channel: string): void {
  if (channel.length < 1 || channel.length > 200) {
    throw errors.validation('a broadcast channel is 1 to 200 UTF-16 code units');
  }
  if (!channel.isWellFormed()) {
    throw errors.validation('a broadcast channel is well-formed text, with no lone surrogate');
  }
  if (channel.includes('\n') || channel.includes('\u0000')) {
    throw errors.validation('a broadcast channel holds no newline and no U+0000');
  }
}
