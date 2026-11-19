import { defineCommand, errors } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { membership } from '../../entities/membership.ts';

/**
 * Moves the ownership of the tenant to the member it is called on; the former owner becomes an
 * admin. The caller's ownership is loaded, not read from the session, so a session that outlives a
 * role change cannot move what its person no longer holds.
 */
const transferOwnershipDef = defineCommand(membersBase, membership, {
  principal: 'user',
  execution: 'sync',
  *decide(_input, current, ctx) {
    const { subject } = ctx.principal;
    if (current.subject === subject) throw errors.validation('You already own this tenant.');
    const owner = yield* ctx.load.members.membership.one({ where: { subject, role: 'owner' } });
    if (owner === undefined) throw errors.forbidden('Only the owner moves ownership.');
    return [
      ctx.write.members.membership.update(owner, { role: 'admin' }),
      ctx.write.members.membership.update(current, { role: 'owner' }),
    ];
  },
});

type TransferOwnershipPart = typeof transferOwnershipDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface TransferOwnership extends TransferOwnershipPart {}
export const transferOwnership: TransferOwnership = transferOwnershipDef;
