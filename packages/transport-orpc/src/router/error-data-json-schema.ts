import { type JsonSchema, type SurfaceError, toJsonSchema } from '@keelwerk/core';

/**
 * The wire error (section 16.4.6) of a declared error as a JSON Schema: its kind and code are
 * constants, `message`, `retryable` and `requestId` are required and `details` is the schema of the
 * error's data as a client receives it.
 */
export function errorDataJsonSchema(error: SurfaceError): JsonSchema {
  return {
    type: 'object',
    properties: {
      kind: { const: error.kind },
      code: { const: error.code },
      message: { type: 'string' },
      retryable: { type: 'boolean' },
      retryAfter: { type: 'number' },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'array', items: { type: ['string', 'integer'] } },
            message: { type: 'string' },
          },
          required: ['path', 'message'],
        },
      },
      ...(error.data === undefined
        ? {}
        : { details: toJsonSchema(error.data, { direction: 'output' }) }),
      reason: { type: 'string' },
      rules: { type: 'array', items: { type: 'object' } },
      requestId: { type: 'string' },
    },
    required: ['kind', 'code', 'message', 'retryable', 'requestId'],
  };
}
