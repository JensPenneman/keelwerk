import type { JsonObject } from './json-object.ts';

/** The `If-Match` header parameter; an operation that requires the version repeats it inline with `required: true`. */
export const ifMatchParameter: JsonObject = {
  name: 'If-Match',
  in: 'header',
  description: 'The `ETag` of the version the change applies to; a mismatch answers 412.',
  schema: { type: 'string' },
};
