import type { GraphQLResolveInfo } from 'graphql';
import { plainOf } from './plain-of.ts';
import { selectionHasField } from './selection-has-field.ts';

/** The wire input of a generated query field: the arguments as JSON, `total` set when `totalCount` is selected (decision D5). */
export function connectionInput(
  args: Readonly<Record<string, unknown>>,
  info: GraphQLResolveInfo,
): Record<string, unknown> {
  const wire = plainOf(args) as Record<string, unknown>;
  return selectionHasField(info, 'totalCount') ? { ...wire, total: true } : wire;
}
