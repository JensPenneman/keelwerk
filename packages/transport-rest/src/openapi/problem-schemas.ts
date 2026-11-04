import type { ApiSurface } from '@keelwerk/core';
import { toJsonSchema } from '@keelwerk/core';
import type { JsonObject } from './json-object.ts';
import { schemaName } from './schema-name.ts';
import { schemaRef } from './schema-ref.ts';

function problemKinds(): string[] {
  return [
    'validation',
    'unauthenticated',
    'forbidden',
    'not_found',
    'conflict',
    'rate_limited',
    'not_implemented',
    'unavailable',
    'unsupported',
    'internal',
  ];
}

function problemSchema(): JsonObject {
  return {
    type: 'object',
    description: 'An RFC 9457 problem; `code` identifies it everywhere (section 16.5.4).',
    properties: {
      type: { type: 'string', format: 'uri' },
      title: { type: 'string' },
      status: { type: 'integer' },
      detail: { type: 'string' },
      instance: { type: 'string' },
      kind: { type: 'string', enum: problemKinds() },
      code: { type: 'string' },
      retryable: { type: 'boolean' },
      retryAfter: { type: 'number', minimum: 0 },
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
      details: {},
      reason: { type: 'string' },
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, effect: { enum: ['allow', 'deny'] } },
          required: ['id', 'effect'],
        },
      },
      requestId: { type: 'string' },
    },
    required: [
      'type',
      'title',
      'status',
      'detail',
      'instance',
      'kind',
      'code',
      'retryable',
      'requestId',
    ],
  };
}

/** `Problem`, and one schema per error some action declares, whose `code` and `kind` are constants (section 16.5.5). */
export function problemSchemas(surface: ApiSurface): Record<string, JsonObject> {
  const declared = new Set(surface.actions.flatMap((action) => action.errors));
  const schemas: Record<string, JsonObject> = Object.fromEntries([['Problem', problemSchema()]]);
  for (const error of surface.errors) {
    if (!declared.has(error.code)) {
      continue;
    }
    schemas[schemaName('problem', error.code)] = {
      allOf: [
        schemaRef('Problem'),
        {
          type: 'object',
          description: error.message,
          properties: {
            code: { const: error.code },
            kind: { const: error.kind },
            retryable: { const: error.retryable },
            ...(error.data === undefined
              ? {}
              : { details: toJsonSchema(error.data, { direction: 'output' }) }),
          },
          required: ['code'],
        },
      ],
    };
  }
  return schemas;
}
