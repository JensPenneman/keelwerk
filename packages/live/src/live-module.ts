import type { ModuleType } from '@keelwerk/core';
import { defineLiveHub, defineModule } from '@keelwerk/core';
import { sseCarrier } from './carriers/sse/sse-carrier.ts';
import { createLiveHub } from './hub/create-live-hub.ts';
import { liveBase } from './live-base.ts';
import { issueTicket } from './tickets/issue-ticket.ts';
import { ticketResolverFill } from './tickets/ticket-resolver-fill.ts';
import { ticketSignedIn } from './tickets/ticket-signed-in.ts';

const liveDef = defineModule(liveBase, {
  actions: { ticket: issueTicket },
  policies: { ticket: { signedIn: ticketSignedIn } },
  contributes: {
    toCore: {
      extensionPoints: {
        liveHub: [defineLiveHub((services) => createLiveHub(services))],
        liveCarriers: [sseCarrier],
        principalResolvers: ticketResolverFill,
      },
    },
  },
  migrations: new URL('../migrations/', import.meta.url),
});

/** The live module: provides the `live` contract, fills the core's `liveHub` point with the hub filler (15.4.1; each runtime opens its own hub), its `liveCarriers` point with the SSE carrier and its principal resolvers with the stream ticket resolver, and issues tickets (`live.ticket`). */
export interface Live extends ModuleType<typeof liveDef> {}

/** The live module. */
export const live: Live = liveDef;
