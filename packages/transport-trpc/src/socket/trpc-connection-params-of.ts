import type { SocketSession } from '@keelwerk/core';

const names = ['token', 'tenant', 'backend', 'apiVersion'] as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The credentials of tRPC's first message, `{ "method": "connectionParams", "data": <object | null> }`:
 * `token`, `tenant`, `backend` and `apiVersion` when they are strings, other members ignored, no
 * `data` (or `null`) none. `undefined` (the caller closes 4000 `protocol_error`) for text that is no JSON object,
 * another `method`, a `data` that is no plain object, or one of the four that is present and no string.
 */
export function trpcConnectionParamsOf(
  text: string,
): Parameters<SocketSession['open']>[0] | undefined {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(message) || message.method !== 'connectionParams') return undefined;
  const data = message.data;
  if (data === undefined || data === null) return {};
  if (!isRecord(data)) return undefined;
  const credentials: Partial<Record<(typeof names)[number], string>> = {};
  for (const name of names) {
    const value = data[name];
    if (value === undefined) continue;
    if (typeof value !== 'string') return undefined;
    credentials[name] = value;
  }
  return credentials;
}
