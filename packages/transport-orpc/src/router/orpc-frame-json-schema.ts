import type { JsonSchema } from '@keelwerk/core';

/**
 * The JSON Schema of one frame of a subscription (section 16.7.7): an item is an object with the
 * event under `data` and, when the source resumes, the stream token under `id`; a control frame
 * is an object with a `control` string and no `data`. `head`, `reset` and `gap` are the controls
 * of today, and `overflow`, `expired` and `resync` the reasons of a reset, but `control` and
 * `reason` are plain strings so that a later kind or reason does not make an older client refuse
 * the document: a client skips a control it does not know and treats a reset of any reason as a
 * reset. The item branch stays closed.
 */
export function orpcFrameJsonSchema(event: JsonSchema): JsonSchema {
  return {
    oneOf: [
      {
        type: 'object',
        properties: { data: event, id: { type: 'string' } },
        required: ['data'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          control: {
            type: 'string',
            description:
              "'head' (with state), 'reset' (with reason, and state when set) or 'gap' (with missed when set); a client skips any other value.",
          },
          state: { type: 'string' },
          reason: {
            type: 'string',
            description:
              "'overflow', 'expired' or 'resync' today; a reader treats a reset of any reason as a reset.",
          },
          missed: { type: 'integer', minimum: 0 },
        },
        required: ['control'],
        not: { required: ['data'] },
      },
    ],
  };
}
