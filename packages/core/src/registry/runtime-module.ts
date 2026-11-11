import type { AnyContract } from '../dsl/define-contract.ts';
import type { AnyEntity, Relations } from '../dsl/define-entity.ts';
import type { ExtensionMode, ExtensionPoint } from '../dsl/extension-point.ts';
import type { ShapeFields } from '../fields/shape.ts';
import type { AnyActionPart } from '../model/action-part.ts';
import type { AnyModule, Dependency } from '../model/any-module.ts';
import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { GeneratorTemplate } from '../model/generator-template.ts';

/** A contribution as `defineModule` stores it. */
interface RuntimeContribution extends BehaviourView {
  readonly key: string;
  readonly to: AnyModule;
  readonly when: readonly Dependency[];
  readonly entities: { readonly [entity: string]: EntityPatchView };
}

/** A conditional part as `defineModule` stores it. */
interface RuntimeConditional extends BehaviourView {
  readonly key: string;
  readonly when: readonly Dependency[];
  readonly entities: { readonly [entity: string]: EntityPatchView };
}

/** Parts mounted under names. */
export type PartMap = { readonly [name: string]: object };

/** Actions mounted under names. */
export type ActionMap = { readonly [name: string]: AnyActionPart };

/** Policies of a behaviour section: a rule directly under its name, or an object grouping the rules of one target. */
export type PolicyMap = { readonly [key: string]: object };

/** What a contribution or a conditional part does to one entity, as the module value keeps it. */
export interface EntityPatchView {
  readonly fields: ShapeFields;
  readonly relations: Relations;
  readonly actions: ActionMap;
}

/** The behaviour half shared by contributions and conditional parts. */
export interface BehaviourView {
  readonly actions: ActionMap;
  readonly policies: PolicyMap;
  readonly reactions: PartMap;
  readonly fills: PartMap;
}

/** An entity of a module value: its definition and the actions mounted on it. */
export interface RuntimeEntity extends AnyEntity {
  readonly actions: ActionMap;
}

/** The module value `defineModule` returns, with the members `compose` reads (section 4.1). */
export interface RuntimeModule {
  readonly kind: 'module';
  readonly id: string;
  readonly version: string;
  readonly base: AnyModuleBase;
  readonly requires: readonly Dependency[];
  readonly optional: readonly Dependency[];
  readonly provides: readonly AnyContract[];
  readonly generates: readonly GeneratorTemplate[];
  readonly extensionPoints: {
    readonly [name: string]: ExtensionPoint<unknown, ExtensionMode, boolean>;
  };
  readonly entities: { readonly [name: string]: RuntimeEntity };
  readonly actions: ActionMap;
  readonly services: PartMap;
  readonly effects: PartMap;
  readonly executors: PartMap;
  readonly policies: PolicyMap;
  readonly reactions: PartMap;
  readonly fills: PartMap;
  readonly schedules: PartMap;
  readonly topics: PartMap;
  readonly changes: PartMap;
  readonly lifecycle: PartMap;
  readonly contributes: readonly RuntimeContribution[];
  readonly conditional: readonly RuntimeConditional[];
  readonly migrations?: URL;
}

/** Reads a module value as the runtime module it is: `defineModule` is the only producer. */
export function runtimeModule(module: AnyModule): RuntimeModule {
  return module as unknown as RuntimeModule;
}
