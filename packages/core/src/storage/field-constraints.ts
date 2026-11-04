/** The declared limits of a field (section 14.5.1). */
export interface FieldConstraints {
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly pattern?: string;
  readonly format?: string;
  readonly min?: number | bigint;
  readonly max?: number | bigint;
  /** `integer({ wide: true })`: read as `bigint`. */
  readonly wide?: boolean;
  readonly precision?: number;
  readonly scale?: number;
  /** An enum's values. */
  readonly values?: readonly string[];
  /** A serial's partition field. */
  readonly per?: string;
}
