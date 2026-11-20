import type { JsonSchema, StandardSchemaV1 } from '@keelwerk/core';

/**
 * A Standard Schema that passes any value unchanged, because the invoker validates once, and
 * describes the node it stands for to the OpenAPI generator.
 */
export interface NodeSchema extends StandardSchemaV1<unknown, unknown> {
  readonly '~keelwerk': {
    /** The JSON Schema of the node, for what a client sends (`input`) or receives (`output`). */
    readonly describe: (direction: 'input' | 'output') => JsonSchema;
    /** The value may be absent (a void input): the generator does not require it. */
    readonly optional: boolean;
  };
}
