import { defineModule, type ModuleType } from '@keelwerk/core';
import { bulletinBase } from './base.ts';
import { membersPin } from './members-pin.ts';
import { pinNotice } from './pin-notice.ts';

const bulletinDef = defineModule(bulletinBase, {
  actions: { pinNotice },
  policies: { pinNotice: { membersPin } },
});

export interface Bulletin extends ModuleType<typeof bulletinDef> {}
/** A module of the tests whose one command is admitted by a rule that uses `hasRole`. */
export const bulletin: Bulletin = bulletinDef;
