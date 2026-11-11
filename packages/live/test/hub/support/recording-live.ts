import type { LiveHubServices, ModuleBaseType } from '@keelwerk/core';
import {
  contracts,
  core,
  defineContribution,
  defineLiveHub,
  defineModule,
  defineModuleBase,
} from '@keelwerk/core';
import { createLiveHub } from '../../../src/hub/create-live-hub.ts';
import type { LiveHubOptions } from '../../../src/hub/live-hub-options.ts';
import type { LiveHubService } from '../../../src/hub/live-hub-service.ts';
import type { Live } from '../../../src/live-module.ts';

const toCore = defineContribution(core, {});

interface RecordingBase extends ModuleBaseType<typeof recordingBaseDef> {}

const recordingBaseDef = defineModuleBase({
  id: 'live',
  version: '0.1.0',
  provides: [contracts.live],
  contributions: { toCore },
});
const recordingBase: RecordingBase = recordingBaseDef;

/** The live module with a filler that keeps each hub it opens, in the order the runtimes opened them. */
export interface RecordingLive {
  readonly module: Live;
  /** Every hub the filler opened: one for each runtime that served the module's app. */
  readonly opened: LiveHubService[];
  /** The services each of those hubs was opened with, in the same order. */
  readonly services: LiveHubServices[];
}

/**
 * A copy of the live module whose filler opens its hub with `options` and pushes it into `opened`,
 * so a test reaches the hub of its own runtime: `subscriptions()` and `close()` of it, never of
 * another's. The services each hub was opened with are kept beside it.
 */
export function recordingLive(options: LiveHubOptions = {}): RecordingLive {
  const opened: LiveHubService[] = [];
  const services: LiveHubServices[] = [];
  const def = defineModule(recordingBase, {
    contributes: {
      toCore: {
        extensionPoints: {
          liveHub: [
            defineLiveHub((given) => {
              const hub = createLiveHub(given, options);
              opened.push(hub);
              services.push(given);
              return hub;
            }),
          ],
        },
      },
    },
  });
  return { module: def as unknown as Live, opened, services };
}
