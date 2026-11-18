import { type ConsumersWorker, consumers, reactionDispatcher } from '@keelwerk/events';

/**
 * The event worker every boot of the portal needs: auth records a login on the profile as an
 * asynchronous reaction, and without a worker that runs `asyncReactions` the boot is refused. Each
 * call makes a new worker, since a worker holds the state of one runtime.
 */
export function portalDispatcher(): ConsumersWorker {
  return consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] });
}
