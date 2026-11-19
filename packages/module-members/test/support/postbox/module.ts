import { defineModule, type ModuleType } from '@keelwerk/core';
import { postboxBase } from './base.ts';
import { invitationDeliveryFill } from './invitation-delivery-fill.ts';

const postboxDef = defineModule(postboxBase, {
  contributes: { toMembers: { extensionPoints: { invitationDelivery: invitationDeliveryFill } } },
});

export interface Postbox extends ModuleType<typeof postboxDef> {}
/** A module that fills the invitation delivery point of members with a recorder, for tests. */
export const postbox: Postbox = postboxDef;
