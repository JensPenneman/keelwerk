import { checkBroadcastChannel } from '@keelwerk/core';

const padded = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** The channel and payload of a `kw_broadcast` text; `undefined` for a text with no `\n`, a channel `checkBroadcastChannel` refuses, or a payload that is not padded base64. */
export function parseBroadcastNotification(
  text: string,
): { readonly channel: string; readonly payload: Uint8Array } | undefined {
  const at = text.indexOf('\n');
  if (at < 0) return undefined;
  const channel = text.slice(0, at);
  const encoded = text.slice(at + 1);
  try {
    checkBroadcastChannel(channel);
  } catch {
    return undefined;
  }
  if (!padded.test(encoded)) return undefined;
  return { channel, payload: Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)) };
}
