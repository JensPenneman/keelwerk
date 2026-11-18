import type {
  ApiSurface,
  Carrier,
  DeprecationNotice,
  InvocationSession,
  Invoker,
  Logger,
  SocketSession,
} from '@keelwerk/core';
import type DataLoader from 'dataloader';
import type { DocumentNode } from 'graphql';

/**
 * What every resolver of one request works from. The handler builds it per request and never
 * shares it between requests or principals: the session, the surface of the session's API version,
 * the per-target loaders and the cookies to set all die with the request.
 */
export interface GraphqlContext {
  readonly session: InvocationSession;
  readonly carrier: Carrier;
  readonly requestId: string;
  readonly traceparent?: string;
  readonly signal: AbortSignal;
  readonly surface: ApiSurface;
  readonly invoker: Invoker;
  readonly development: boolean;
  readonly logger: Logger;
  readonly now?: Temporal.Instant;
  /** The documents the gate parsed, measured and validated, by query text. */
  readonly documents: ReadonlyMap<string, DocumentNode>;
  /** One DataLoader per target entity ref, created on first use; dies with the request. */
  loaderOf(entity: string): DataLoader<string, unknown>;
  /** Drops every loaded row: a command may have changed what a reference shows, so later fields of the request read afresh. */
  clearLoaders(): void;
  /** The host's session of the socket the operation runs on (graphql-ws); absent over HTTP. */
  readonly socket?: SocketSession;
  /** The action notices (deprecated actions) the next answer must carry; `graphqlAnswerOf` empties it. */
  readonly notices: DeprecationNotice[];
  /** Set-Cookie values the cookie hint produced, appended to the response. */
  readonly setCookies: string[];
}
