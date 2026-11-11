import { defineLiveHub, defineModule } from '@keelwerk/core';
import { sseCarrier } from '../../src/carriers/sse/sse-carrier.ts';
import { createLiveHub } from '../../src/hub/create-live-hub.ts';
import type { LiveHubOptions } from '../../src/hub/live-hub-options.ts';
import type { LiveHubService } from '../../src/hub/live-hub-service.ts';
import { liveBase } from '../../src/live-base.ts';
import type { Live } from '../../src/live-module.ts';
import { issueTicket } from '../../src/tickets/issue-ticket.ts';
import { ticketResolverFill } from '../../src/tickets/ticket-resolver-fill.ts';
import { ticketSignedIn } from '../../src/tickets/ticket-signed-in.ts';

/** The live module with its hub opened with `options`, and every hub it opened, for a test that shortens the revalidation timer. */
export interface FullLive {
  readonly module: Live;
  readonly opened: LiveHubService[];
}

/** A copy of the whole live module (tickets, carrier, resolver) whose hub filler passes `options` to the hub. */
export function fullLive(options: LiveHubOptions = {}): FullLive {
  const opened: LiveHubService[] = [];
  const def = defineModule(liveBase, {
    actions: { ticket: issueTicket },
    policies: { ticket: { signedIn: ticketSignedIn } },
    contributes: {
      toCore: {
        extensionPoints: {
          liveHub: [
            defineLiveHub((services) => {
              const hub = createLiveHub(services, options);
              opened.push(hub);
              return hub;
            }),
          ],
          liveCarriers: [sseCarrier],
          principalResolvers: ticketResolverFill,
        },
      },
    },
  });
  return { module: def as unknown as Live, opened };
}
