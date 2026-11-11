import type { LiveView } from '@keelwerk/core';
import { planGroupKey } from './plan-group-key.ts';

/** The subscribers of a pass that read and mask alike, by `${entity} ${planKey}`: one representative view each. */
export type PlanGroups = ReadonlyMap<string, { readonly entity: string; readonly view: LiveView }>;

/** Groups views whose plans are equal; each distinct plan is evaluated once per batch (8.4, 15.2.5). */
export function planGroups(views: readonly LiveView[]): PlanGroups {
  const groups = new Map<string, { readonly entity: string; readonly view: LiveView }>();
  for (const view of views) {
    const key = planGroupKey(view);
    if (!groups.has(key)) groups.set(key, { entity: view.entity, view });
  }
  return groups;
}
