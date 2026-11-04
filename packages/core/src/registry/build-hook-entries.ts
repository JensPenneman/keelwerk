import type { HookPayloads } from '../dsl/define-hook.ts';
import type { ActionHandler } from './action-handler.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { HookEntry } from './hook-entry.ts';
import type { RuntimeModule } from './runtime-module.ts';

const hookUnits: Readonly<Record<keyof HookPayloads, HookEntry['unit']>> = {
  onTenantCreated: 'tenant',
  onTenantArchived: 'tenant',
  onBackendCreated: 'backend',
};

function isHookName(name: string): name is keyof HookPayloads {
  return Object.hasOwn(hookUnits, name);
}

/** The lifecycle hooks by id and the problems met. */
export interface BuiltHooks {
  readonly hooks: ReadonlyMap<string, HookEntry>;
  readonly problems: readonly CompositionProblem[];
}

/**
 * The lifecycle hooks of the modules (section 3.3). Each keeps the name of the DSL and runs in a
 * unit of its own at the level of that name after the creating unit commits (S-27); a hook name the
 * DSL does not define is the problem `unknownHooks`.
 */
export function buildHookEntries(ordered: readonly RuntimeModule[]): BuiltHooks {
  const hooks = new Map<string, HookEntry>();
  const problems: CompositionProblem[] = [];
  for (const module of ordered) {
    for (const [key, part] of Object.entries(module.lifecycle)) {
      const hook = Reflect.get(part, 'hook') as string;
      const id = `${module.id}.${key}`;
      if (!isHookName(hook)) {
        problems.push(
          compositionError(
            'unknownHooks',
            `Lifecycle hook '${id}' names the unknown hook '${hook}'.`,
            {
              module: module.id,
              ref: id,
            },
          ),
        );
        continue;
      }
      hooks.set(id, {
        id,
        module: module.id,
        hook,
        unit: hookUnits[hook],
        react: Reflect.get(part, 'fn') as ActionHandler,
      });
    }
  }
  return { hooks, problems };
}
