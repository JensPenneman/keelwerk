import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { runtimeAnswered } from './runtime-answered.ts';

/** The registry with a placeholder handler on the actions the runtime answers, so the pipeline authorises and shapes them like any query. */
export function servedRegistry(registry: Registry): Registry {
  const actions = new Map(registry.actions);
  for (const ref of runtimeAnswered) {
    const action = actions.get(ref);
    if (action === undefined) continue;
    const answered: ActionEntry = { ...action, handler: () => ({}) };
    actions.set(ref, answered);
  }
  return { ...registry, actions };
}
