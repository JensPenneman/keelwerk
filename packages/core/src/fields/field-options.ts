import type { StandardSchemaV1 } from './standard-schema-v1.ts';

/** Options of `field.string()` and `field.text()`. */
export interface StringOptions {
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly pattern?: string;
  readonly format?: 'email' | 'uri' | 'hostname';
}

/** Options of `field.integer()`. */
export interface IntegerOptions {
  readonly min?: number;
  readonly max?: number;
  readonly wide?: boolean;
}

/** Options of `field.decimal()`. */
export interface DecimalOptions {
  readonly precision: number;
  readonly scale: number;
}

/** Options of `field.blob()`. */
export interface BlobOptions {
  readonly mediaType?: string;
  readonly maxBytes?: number;
}

/** Options of `field.serial()`. */
export interface SerialOptions {
  readonly per?: string;
}

/** The constraints a builder recorded, by kind: what projections and validation read. */
export type FieldOptions =
  | StringOptions
  | IntegerOptions
  | DecimalOptions
  | BlobOptions
  | SerialOptions
  | StandardSchemaV1
  | readonly string[]
  | undefined;
