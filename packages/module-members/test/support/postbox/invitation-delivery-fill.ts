import { defineFill, within } from '@keelwerk/core';
import { postboxBase } from './base.ts';
import { sentInvitations } from './sent-invitations.ts';
import { toMembers } from './to-members.ts';

/** Keeps every invitation message for the test to read. The token stays in test memory, never in an effect. */
export const invitationDeliveryFill = defineFill(
  within(postboxBase, toMembers),
  'invitationDelivery',
  () => [
    {
      id: 'postbox.test',
      *deliver(message) {
        sentInvitations.push(message);
        yield* [];
        return [];
      },
    },
  ],
);
