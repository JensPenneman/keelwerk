import { cancelTimer, defineCommand, field, shape } from '@keelwerk/core';
import { laterBase } from './base.ts';

/**
 * Cancels the timer of `key` that this module set, as a module that holds another module's key text
 * would.
 */
const cancelTimerKeyDef = defineCommand(laterBase, {
  input: shape({ key: field.string() }),
  principal: 'user',
  execution: 'sync',
  decide: (input) => ({ events: [], effects: [cancelTimer(input.key)] }),
});

type CancelTimerKeyPart = typeof cancelTimerKeyDef;
export interface CancelTimerKey extends CancelTimerKeyPart {}
export const cancelTimerKey: CancelTimerKey = cancelTimerKeyDef;
