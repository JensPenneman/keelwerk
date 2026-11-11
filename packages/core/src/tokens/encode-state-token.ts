import type { StateToken } from '../events/state-token.ts';
import { sealTokenCheck } from './seal-token-check.ts';
import type { StateTokenSource } from './state-token-parts.ts';

/** `v2.<epoch in base 36>.<position in decimal>.<scope>.<check>` (section 15.2.6); the check is sealed under the scope's token key and covers the other parts. */
export function encodeStateToken(source: StateTokenSource, key: Uint8Array): StateToken {
  return `v2.${source.epoch.toString(36)}.${source.position.toString()}.${source.scope}.${sealTokenCheck(source, key)}` as StateToken;
}
