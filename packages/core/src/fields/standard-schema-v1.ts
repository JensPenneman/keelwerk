import type { StandardSchemaV1 as Spec } from '@standard-schema/spec';

/** One problem found by a validation. */
export type StandardIssue = Spec.Issue;

/** The result of a Standard Schema validation. */
export type StandardResult<Output> = Spec.Result<Output>;

/** The `~standard` member of a Standard Schema (version 1). */
export type StandardSchemaProps<Input, Output> = Spec.Props<Input, Output>;

/** Any Standard Schema, the interface `field.json` and the transports accept (section 6.5). */
export type StandardSchemaV1<Input = unknown, Output = Input> = Spec<Input, Output>;

/** The output type of a Standard Schema. */
export type StandardOutput<S extends StandardSchemaV1> = Spec.InferOutput<S>;
