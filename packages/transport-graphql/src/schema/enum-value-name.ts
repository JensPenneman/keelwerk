/**
 * The GraphQL name of an enum value (section 16.6.1): a `_` between a lower-case letter or digit
 * and the upper-case letter after it, every character outside `[_0-9A-Za-z]` replaced by `_` (one
 * for one), then upper-cased. `shared-tables` is `SHARED_TABLES`, `inProgress` is `IN_PROGRESS`
 * and `true` is `TRUE`. GraphQL serialises an enum by its name, so an answer carries the name and
 * a client sends it; REST, JSON and the values inside a `JSON` scalar keep the wire value. Total
 * and one way: the name is read back only through the enum type, never computed. A mapped name
 * can still be no GraphQL name (the empty value, a leading digit) or reserved (`__`); the schema
 * draft reports those.
 */
export function enumValueName(value: string): string {
  return value
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll(/[^_0-9A-Za-z]/gu, '_')
    .toUpperCase();
}
