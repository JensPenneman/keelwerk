import type { JsonObject } from './json-object.ts';

const common = ['requestId', 'keelwerkVersion'];

/** Component key to HTTP header name. */
const headerNames: ReadonlyMap<string, string> = new Map([
  ['etag', 'ETag'],
  ['idempotentReplayed', 'Idempotent-Replayed'],
  ['keelwerkCommandId', 'Keelwerk-Command-Id'],
  ['keelwerkEffects', 'Keelwerk-Effects'],
  ['keelwerkVersion', 'Keelwerk-Version'],
  ['link', 'Link'],
  ['location', 'Location'],
  ['preferenceApplied', 'Preference-Applied'],
  ['requestId', 'x-request-id'],
  ['retryAfter', 'Retry-After'],
]);

/** Response headers by component key, with the two every response carries: the request id and the API version. */
export function headersOf(...keys: readonly string[]): JsonObject {
  return Object.fromEntries(
    [...common, ...keys].map((key) => [
      headerNames.get(key) ?? key,
      { $ref: `#/components/headers/${key}` },
    ]),
  );
}
