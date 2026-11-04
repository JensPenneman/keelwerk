import type { RequestMatcher } from './request-matcher.ts';

/** `load.<module>.<entity>.<op>(...)`: the request the handler is expected to yield. */
export interface EntityLoadMatchers {
  byId(id: string): RequestMatcher;
  one(query: object): RequestMatcher;
  many(query?: object): RequestMatcher;
  count(where?: object): RequestMatcher;
  exists(where: object): RequestMatcher;
  query(query?: object): RequestMatcher;
}
