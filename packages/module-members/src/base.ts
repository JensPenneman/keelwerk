import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';
import { auth } from '@keelwerk/module-auth';
import { toCore } from './contributions/to-core/contribution.ts';
import { invitation } from './entities/invitation.ts';
import { membership } from './entities/membership.ts';
import { invitationDelivery } from './extension-points/invitation-delivery.ts';

const membersBaseDef = defineModuleBase({
  id: 'members',
  version: '0.1.0',
  optional: [accounts, auth],
  extensionPoints: { invitationDelivery },
  entities: { invitation, membership },
  contributions: { toCore },
});

export interface MembersBase extends ModuleBaseType<typeof membersBaseDef> {}
export const membersBase: MembersBase = membersBaseDef;
