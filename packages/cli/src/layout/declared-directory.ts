import { kebab } from '@keelwerk/core';
import type { CallFacts } from './parsed-source.ts';

/**
 * The directory a contribution or condition declaration belongs in: `to-<target>` with
 * `-when-<id>` per `when` module, or `when-<ids>` joined by `-and-` (section 23.4). Undefined when
 * the call does not name its modules as identifiers.
 */
export function declaredDirectory(call: CallFacts): string | undefined {
  const first = call.args[0];
  if (call.callee === 'defineContribution') {
    if (first?.kind !== 'identifier') return undefined;
    const options = call.args.find((arg) => arg.kind === 'object');
    const whens = options?.kind === 'object' ? (options.facts.names.get('when') ?? []) : [];
    return `to-${kebab(first.name)}${whens.map((id) => `-when-${kebab(id)}`).join('')}`;
  }
  if (call.callee === 'defineCondition' && first?.kind === 'list' && first.names.length > 0) {
    return `when-${first.names.map(kebab).join('-and-')}`;
  }
  return undefined;
}
