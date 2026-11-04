/** The result of a Standard Schema validation. */
export type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly { readonly message: string }[] };

/** The `~standard` member of a Standard Schema (version 1). */
export interface StandardSchemaProps<Input, Output> {
  readonly version: 1;
  readonly vendor: string;
  readonly validate: (value: unknown) => StandardResult<Output>;
  readonly types?: { readonly input: Input; readonly output: Output } | undefined;
}

/** Any Standard Schema, the interface `field.json` and the transports accept (section 6.5). */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaProps<Input, Output>;
}

/** The output type of a Standard Schema. */
export type StandardOutput<S extends StandardSchemaV1> = NonNullable<
  S['~standard']['types']
>['output'];
