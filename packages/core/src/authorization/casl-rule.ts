/**
 * A rule in CASL's raw-rule shape (section 8.7): what `core.me` hands a user interface so it can
 * hide what the principal cannot do. `serverOnly` marks a rule that cannot be evaluated without
 * data the client lacks; the server still enforces every rule.
 */
export interface CaslRule {
  /** Action names; `manage` stands for every action. */
  readonly action: readonly string[];
  /** The entity reference, the module id for module-level rules, or `all`. */
  readonly subject: string;
  /** Mongo-style conditions as CASL's matcher reads them; absent: every row. */
  readonly conditions?: Readonly<Record<string, unknown>>;
  readonly fields?: readonly string[];
  readonly inverted?: boolean;
  readonly reason?: string;
  readonly serverOnly?: true;
}
