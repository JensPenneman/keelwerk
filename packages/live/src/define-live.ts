import { defineLiveHub, defineModule } from '@keelwerk/core';
import { sseCarrier } from './carriers/sse/sse-carrier.ts';
import { websocketCarrier } from './carriers/websocket/websocket-carrier.ts';
import { createLiveHub } from './hub/create-live-hub.ts';
import { liveBase } from './live-base.ts';
import type { PokesJoinObserver } from './pokes/create-pokes-source.ts';
import { createPokesSource } from './pokes/create-pokes-source.ts';
import { pokesAction } from './pokes/pokes-action.ts';
import { pokesSignedIn } from './pokes/pokes-signed-in.ts';
import { issueTicket } from './tickets/issue-ticket.ts';
import { ticketResolverFill } from './tickets/ticket-resolver-fill.ts';
import { ticketSignedIn } from './tickets/ticket-signed-in.ts';

/**
 * The one definition of the live module. `observe` tells the tests of this package when the reader
 * of a pokes subscription has joined, and `opened` that a runtime has opened a hub from this
 * module; the package's own `live` is made without either.
 */
export const defineLive = (observe?: PokesJoinObserver, opened?: () => void) =>
  defineModule(liveBase, {
    actions: { pokes: pokesAction, ticket: issueTicket },
    policies: { pokes: { signedIn: pokesSignedIn }, ticket: { signedIn: ticketSignedIn } },
    contributes: {
      toCore: {
        extensionPoints: {
          liveHub: [
            defineLiveHub((services) =>
              createLiveHub(services, {
                sources: {
                  pokes: (readers, hub) => {
                    opened?.();
                    return createPokesSource(readers, hub, observe);
                  },
                },
              }),
            ),
          ],
          liveCarriers: [sseCarrier, websocketCarrier],
          principalResolvers: ticketResolverFill,
        },
      },
    },
    migrations: new URL('../migrations/', import.meta.url),
  });
