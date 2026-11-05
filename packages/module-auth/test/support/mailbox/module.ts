import { defineModule, type ModuleType } from '@keelwerk/core';
import { mailboxBase } from './base.ts';
import { resetDeliveryFill } from './reset-delivery-fill.ts';

const mailboxDef = defineModule(mailboxBase, {
  contributes: { toAuth: { extensionPoints: { resetDelivery: resetDeliveryFill } } },
});

export interface Mailbox extends ModuleType<typeof mailboxDef> {}
/** A module that fills auth's reset delivery point with a recorder, for tests. */
export const mailbox: Mailbox = mailboxDef;
