import { ifMatchParameter } from './if-match-parameter.ts';
import type { JsonObject } from './json-object.ts';
import { problemResponse } from './problem-response.ts';

const stringHeader = (description: string): JsonObject => ({
  description,
  schema: { type: 'string' },
});

/** The components every document carries: `PageInfo`, `CommandReceipt`, and the shared headers and parameters (section 16.5.5). */
export function commonComponents(): {
  readonly schemas: Record<string, JsonObject>;
  readonly headers: Record<string, JsonObject>;
  readonly parameters: Record<string, JsonObject>;
  readonly responses: Record<string, JsonObject>;
} {
  return {
    responses: Object.fromEntries(
      [400, 401, 403, 404, 412, 413, 422, 429, 500, 503].map((status) => [
        `problem${status}`,
        problemResponse(status, []),
      ]),
    ),
    schemas: Object.fromEntries([
      [
        'PageInfo',
        {
          type: 'object',
          properties: {
            hasNextPage: { type: 'boolean' },
            hasPreviousPage: { type: 'boolean' },
            startCursor: { type: ['string', 'null'] },
            endCursor: { type: ['string', 'null'] },
          },
          required: ['hasNextPage', 'hasPreviousPage', 'startCursor', 'endCursor'],
        },
      ],
      [
        'CommandReceipt',
        {
          type: 'object',
          properties: {
            commandId: { type: 'string' },
            status: { const: 'accepted' },
          },
          required: ['commandId', 'status'],
          additionalProperties: false,
        },
      ],
    ]),
    headers: {
      etag: stringHeader(
        'The entity tag of the row; send it back as `If-Match` or `If-None-Match`.',
      ),
      idempotentReplayed: stringHeader(
        '`true` when the response replays an earlier command with the same key.',
      ),
      keelwerkCommandId: stringHeader('The command id (the idempotency key, or one generated).'),
      keelwerkEffects: stringHeader(
        'The ids of the external effects the command requested, comma separated.',
      ),
      keelwerkVersion: stringHeader('The API version that answered.'),
      link: stringHeader('RFC 8288 links to the neighbouring pages.'),
      location: stringHeader('Where the created row or the command receipt can be fetched.'),
      preferenceApplied: stringHeader('The `Prefer` preferences that were honoured.'),
      requestId: stringHeader('The request id, also `requestId` of an error body.'),
      retryAfter: {
        description: 'Seconds to wait before retrying.',
        schema: { type: 'integer', minimum: 0 },
      },
    },
    parameters: {
      idempotencyKey: {
        name: 'Idempotency-Key',
        in: 'header',
        description: 'The command id: a repeated key replays the first answer.',
        schema: { type: 'string' },
      },
      ifMatch: ifMatchParameter,
      ifNoneMatch: {
        name: 'If-None-Match',
        in: 'header',
        description: 'An `ETag` the client holds; a match answers 304.',
        schema: { type: 'string' },
      },
      prefer: {
        name: 'Prefer',
        in: 'header',
        description:
          '`respond-async` to get the 202 receipt, optionally with `wait=<seconds>` (at most 60).',
        schema: { type: 'string' },
      },
    },
  };
}
