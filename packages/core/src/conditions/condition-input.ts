/** The object form authors write (`{ ownerId: subject }`, `{ revokedAt: { isNull: false } }`), before it normalises to a `Condition`. */
export type ConditionInput = Readonly<Record<string, unknown>>;
