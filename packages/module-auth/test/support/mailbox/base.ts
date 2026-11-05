import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { auth } from '../../../src/module.generated.ts';
import { toAuth } from './to-auth.ts';

const mailboxBaseDef = defineModuleBase({
  id: 'mailbox',
  version: '0.0.0',
  requires: [auth],
  contributions: { toAuth },
});

export interface MailboxBase extends ModuleBaseType<typeof mailboxBaseDef> {}
export const mailboxBase: MailboxBase = mailboxBaseDef;
