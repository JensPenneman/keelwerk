import type { Registry } from '../registry/registry.ts';

/** The error codes the actions of `module` declare: the codes an effect of that module may store besides the core's. */
export function declaredErrorCodesOf(
  registry: Pick<Registry, 'actions'>,
  module: string | undefined,
): ReadonlySet<string> {
  const codes = new Set<string>();
  if (module === undefined) return codes;
  for (const action of registry.actions.values()) {
    if (action.module === module) for (const code of action.errors) codes.add(code);
  }
  return codes;
}
