import { defineApp } from '@keelwerk/core';
import type { RelayApp } from './relay-app.ts';
import { relay } from './relay-module.ts';
import { watch } from './watch-module.ts';

/**
 * The relay app with only the named reactions of the relay module, as one deploy of a later version
 * would have it; `quiet` also drops the reactions of the watch module, so the app has no
 * asynchronous reaction and needs no dispatcher. The result has the relay app's type, so the kit
 * takes it; a reaction the module does not have is an error.
 */
export function relayWithReactions(
  names: readonly (keyof typeof relay.reactions)[],
  quiet = false,
): RelayApp {
  const reactions = Object.fromEntries(names.map((name) => [name, relay.reactions[name]]));
  const trimmed = { ...relay, reactions } as typeof relay;
  const watched = quiet ? ({ ...watch, reactions: {} } as typeof watch) : watch;
  return defineApp({ id: 'relayapp', modules: [trimmed, watched] as const }) as unknown as RelayApp;
}
