import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { permissiveSchema } from '../registry/permissive-schema.ts';

/** The input shape of a reaction job: `ReactionJobInput`. */
export const reactionJobInputShape: StandardSchemaV1 = shape({
  event: field.string(),
  streamType: field.string(),
  streamId: field.string(),
  version: field.integer(),
  position: field.string(),
  processStream: field.string().optional(),
  // The sealed subject of a process job, or null; the worker opens it, nothing else reads it.
  subject: field.json(permissiveSchema()).optional(),
  keyError: field.string().optional(),
});
