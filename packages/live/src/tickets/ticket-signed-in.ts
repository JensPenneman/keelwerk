import { defineRule } from '@keelwerk/core';
import { liveBase } from '../live-base.ts';
import { issueTicket } from './issue-ticket.ts';

/** Any signed-in user may ask for a ticket for their own stream. */
export const ticketSignedIn = defineRule(liveBase, issueTicket, {
  effect: 'allow',
  principal: 'user',
});
