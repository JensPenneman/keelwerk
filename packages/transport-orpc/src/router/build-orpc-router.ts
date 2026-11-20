import type { ApiSurface } from '@keelwerk/core';
import type { AnyProcedure, AnyRouter } from '@orpc/server';
import { orpcPathOf } from './orpc-path-of.ts';
import { procedureFor } from './procedure-for.ts';

interface Tree {
  [name: string]: AnyProcedure | Tree;
}

function isTree(value: AnyProcedure | Tree | undefined): value is Tree {
  return value !== undefined && !('~orpc' in value);
}

/**
 * The oRPC router of one API version's surface: nested plain objects keyed by `orpcPathOf` (the
 * module, the entity of an entity action, the action), one procedure for every action of the surface.
 */
export function buildOrpcRouter(surface: ApiSurface): AnyRouter {
  const root: Tree = {};
  for (const action of surface.actions) {
    const path = orpcPathOf(action);
    const name = path.at(-1);
    if (name === undefined) continue;
    let node = root;
    for (const key of path.slice(0, -1)) {
      const held = Object.hasOwn(node, key) ? node[key] : undefined;
      if (isTree(held)) {
        node = held;
      } else {
        const next: Tree = {};
        node[key] = next;
        node = next;
      }
    }
    node[name] = procedureFor(surface, action);
  }
  return root;
}
