import { defineCommand, field, setTimer, shape } from '@keelwerk/core';
import { laterBase } from './base.ts';
import { ping } from './ping.ts';

/** Sets a timer that runs `later.ping` at a later instant: the timer runs under the module's own principal, not the caller's. */
const pingAtDef = defineCommand(laterBase, {
  input: shape({ at: field.instant(), key: field.string() }),
  principal: 'user',
  execution: 'sync',
  decide: (input) => ({
    events: [],
    effects: [setTimer({ key: input.key, at: input.at, invoke: ping, input: { note: input.key } })],
  }),
});

type PingAtPart = typeof pingAtDef;
export interface PingAt extends PingAtPart {}
export const pingAt: PingAt = pingAtDef;
