import type { DerivedIndexField, FieldDescriptor } from '@keelwerk/core';

/**
 * Converts one column's values between the domain (`Temporal.Instant`, `bigint`, `Uint8Array`,
 * `ReadonlySet`, ...) and what the driver binds and returns (section 14.5.1). Callers bind SQL
 * `NULL` for an absent value; `encode` never receives `null` or `undefined`.
 */
export interface ValueCodec {
  /** A domain value as the parameter the driver binds. */
  readonly encode: (value: unknown) => unknown;
  /** What the statement returned (after the `readAsText` cast, if any) as the domain value. */
  readonly decode: (value: unknown) => unknown;
  /** The SQL type of the column; list operands are cast to an array of it. */
  readonly sqlType: string;
  /**
   * Select the column cast to `text`, so every driver returns the same string whatever its type
   * parsers do (64-bit integers, `numeric`, `date`).
   */
  readonly readAsText: boolean;
}

/** The codecs of one dialect: one per field, one per derived index column. */
export interface DialectCodecs {
  forField(field: FieldDescriptor): ValueCodec;
  forDerivedIndex(index: DerivedIndexField): ValueCodec;
}
