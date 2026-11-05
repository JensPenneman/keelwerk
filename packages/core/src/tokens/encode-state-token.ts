import type { StateToken } from '../events/state-token.ts';
import type { StateTokenParts } from './state-token-parts.ts';

/** `v1.<epoch in base 36>.<position in decimal>.<scope>.<check>` (section 15.2.6). Final from M1. */
export function encodeStateToken(parts: StateTokenParts): StateToken {
  return `v1.${parts.epoch.toString(36)}.${parts.position.toString()}.${parts.scope}.${parts.check}` as StateToken;
}
