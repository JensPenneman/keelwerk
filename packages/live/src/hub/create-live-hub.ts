import type {
  EntityChange,
  InvocationSession,
  LiveFrame,
  LiveHub,
  LiveHubServices,
  StateToken,
} from '@keelwerk/core';
import { errors, KeelwerkError } from '@keelwerk/core';
import { createScopeReaders } from './create-scope-readers.ts';
import { createEntitySubscriber } from './entity-subscriber.ts';
import type { HubMember } from './hub-member.ts';
import type { LiveHubOptions } from './live-hub-options.ts';
import type { LiveHubService } from './live-hub-service.ts';
import type { LiveSubscription } from './live-subscription.ts';
import { resolveHubLimits } from './resolve-hub-limits.ts';
import { createStartLimiter } from './start-limiter.ts';

function unavailable(code: string, message: string): AsyncIterable<LiveFrame<never>> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.reject(new KeelwerkError({ kind: 'unavailable', code, message })),
    }),
  };
}

const notAvailableHere = (): AsyncIterable<LiveFrame<never>> =>
  unavailable('core.live_unavailable', 'This live source is not available in this release.');

const stopped = (): AsyncIterable<LiveFrame<never>> =>
  unavailable('core.unavailable', 'The live hub has stopped.');

/**
 * Opens the hub of one runtime for one app (9.6, 15.4.1): everything it holds, its readers, its
 * members and its limits, lives in this closure, so two hubs share nothing. It keeps no timer and no
 * reader until a subscription attaches. `entity` is served here; the other members come from
 * `options.sources` and answer `core.live_unavailable` while no source is given. `close` ends every
 * subscription without a frame or an error and stops the readers; afterwards every member answers an
 * iterable whose `next()` is `unavailable`.
 */
export function createLiveHub(
  services: LiveHubServices,
  options: LiveHubOptions = {},
): LiveHubService {
  const limits = resolveHubLimits(options);
  const readers = createScopeReaders(limits, services);
  const startUnits = createStartLimiter(limits.maxStartUnitsPerScope, limits.maxStartUnits);
  const members = new Set<HubMember>();
  const pokes = options.sources?.pokes?.(readers);
  const stream = options.sources?.stream?.(readers);
  const topic = options.sources?.topic?.(readers);
  let closing: Promise<void> | undefined;
  const isClosed = (): boolean => closing !== undefined;
  return {
    entity: <Row>(
      session: InvocationSession,
      entity: string,
      input: Parameters<LiveHub['entity']>[2],
      resume?: StateToken,
    ): AsyncIterable<LiveFrame<EntityChange<Row>>> =>
      isClosed()
        ? stopped()
        : (createEntitySubscriber({
            session,
            entity,
            input,
            resume,
            readers,
            limits,
            startUnits,
            register: (member) => {
              // A stream made before the hub closed and first read after it is a new subscription.
              if (isClosed()) throw errors.unavailable('The live hub has stopped.');
              members.add(member);
              return () => {
                members.delete(member);
              };
            },
          }) as AsyncIterable<LiveFrame<EntityChange<Row>>>),
    pokes: (session, resume) =>
      isClosed() ? stopped() : pokes === undefined ? notAvailableHere() : pokes(session, resume),
    stream: (session, name, key, streamOptions, resume) =>
      isClosed()
        ? stopped()
        : stream === undefined
          ? notAvailableHere()
          : stream(session, name, key, streamOptions, resume),
    topic: (session, name, key) =>
      isClosed() ? stopped() : topic === undefined ? notAvailableHere() : topic(session, name, key),
    subscriptions: (): readonly LiveSubscription[] =>
      [...members].map((member) => member.subscription),
    close: (deadline) => {
      closing ??= (async () => {
        const ending = [...members].map((member) => member.close());
        const finished = Promise.all([...ending, readers.close(deadline)]).then(() => undefined);
        const expired = new Promise<void>((resolve) => {
          if (deadline.aborted) resolve();
          else deadline.addEventListener('abort', () => resolve(), { once: true });
        });
        // Never rejects: a member or a reader that fails to settle is waited for until the deadline only.
        await Promise.race([finished.catch(() => undefined), expired]);
        members.clear();
      })();
      return closing;
    },
  };
}
