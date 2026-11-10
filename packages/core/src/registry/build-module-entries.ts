import type { FlagPurpose } from '../dsl/define-flag.ts';
import { camelFromKebab } from '../naming/camel-from-kebab.ts';
import type { ActionEntry } from './action-entry.ts';
import { dependencyName } from './dependency-name.ts';
import type { EntityModel } from './entity-model.ts';
import type { ExtensionPointEntry } from './extension-point-entry.ts';
import type { HookEntry } from './hook-entry.ts';
import type { ModuleEntry } from './module-entry.ts';
import type { ReactionEntry } from './reaction-entry.ts';
import type { RuleEntry } from './rule-entry.ts';
import type { RuntimeModule } from './runtime-module.ts';
import type { ServiceEntry } from './service-entry.ts';

interface FlagView {
  readonly kind: 'boolean' | 'string' | 'number' | 'json' | 'variant';
  readonly level: 'deployment' | 'backend' | 'tenant' | 'principal';
  readonly default: unknown;
  readonly variants?: readonly string[];
  readonly purpose?: FlagPurpose;
  readonly expires?: string;
  readonly client?: boolean;
}

function owned<T extends { readonly module: string; readonly contributedBy?: string | undefined }>(
  entries: Iterable<[string, T]>,
  module: string,
): readonly string[] {
  return [...entries]
    .filter(([, entry]) => (entry.contributedBy ?? entry.module) === module)
    .map(([ref]) => ref);
}

/** The maps the entries of a module are collected from. */
export interface ModuleEntryParts {
  readonly entities: ReadonlyMap<string, EntityModel>;
  readonly actions: ReadonlyMap<string, ActionEntry>;
  readonly rules: ReadonlyMap<string, RuleEntry>;
  readonly reactions: ReadonlyMap<string, ReactionEntry>;
  readonly hooks: ReadonlyMap<string, HookEntry>;
  readonly services: ReadonlyMap<string, ServiceEntry>;
  readonly extensionPoints: ReadonlyMap<string, ExtensionPointEntry>;
}

/** The module entries in topological order (section 3.3), each listing the references of what it owns or mounts. */
export function buildModuleEntries(
  ordered: readonly RuntimeModule[],
  parts: ModuleEntryParts,
): readonly ModuleEntry[] {
  return ordered.map((module, order) => {
    const dependencies = [...module.requires, ...module.optional];
    const flags = (module.base.flags ?? {}) as { readonly [name: string]: FlagView };
    return {
      id: module.id,
      contextName: camelFromKebab(module.id),
      version: module.version,
      order,
      requires: module.requires.filter((d) => d.kind === 'module').map(dependencyName),
      optional: module.optional.filter((d) => d.kind === 'module').map(dependencyName),
      provides: module.provides.map((contract) => contract.contract),
      needs: dependencies.filter((d) => d.kind === 'contract').map(dependencyName),
      entities: [...parts.entities.values()]
        .filter((model) => model.entry.module === module.id)
        .map((model) => model.entry.ref),
      actions: owned(parts.actions, module.id),
      rules: [...parts.rules].filter(([, rule]) => rule.module === module.id).map(([id]) => id),
      reactions: [...parts.reactions].filter(([, r]) => r.module === module.id).map(([id]) => id),
      hooks: [...parts.hooks].filter(([, hook]) => hook.module === module.id).map(([id]) => id),
      services: [...parts.services].filter(([, s]) => s.module === module.id).map(([ref]) => ref),
      extensionPoints: [...parts.extensionPoints]
        .filter(([, point]) => point.module === module.id)
        .map(([ref]) => ref),
      flags: Object.fromEntries(
        Object.entries(flags).map(([name, flag]) => [
          name,
          {
            kind: flag.kind,
            level: flag.level,
            default: flag.default,
            ...(flag.variants === undefined ? {} : { variants: flag.variants }),
            ...(flag.purpose === undefined ? {} : { purpose: flag.purpose }),
            ...(flag.expires === undefined ? {} : { expires: flag.expires }),
            ...(flag.client === undefined ? {} : { client: flag.client }),
          },
        ]),
      ),
    };
  });
}
