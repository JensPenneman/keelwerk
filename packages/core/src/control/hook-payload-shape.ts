import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';

/** The input of the command a lifecycle hook decides as: the payload of the hook (3.3). */
export const hookPayloadShape: StandardSchemaV1 = shape({
  id: field.string(),
  name: field.string().optional(),
});
