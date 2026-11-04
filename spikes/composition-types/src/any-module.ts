import type { AnyActionPart } from './action-part.ts';
import type { AnyContract } from './define-contract.ts';
import type {
  EventShapes,
  GeneratedOptions,
  GeneratorTemplate,
  HistoryMode,
  Relations,
} from './define-entity.ts';
import type { ExtensionPoint } from './extension-point.ts';
import type { ShapeFields } from './shape.ts';

type Actions = { readonly [name: string]: AnyActionPart };

/** A dependency: a module value or a contract (section 5.2). */
export type Dependency = AnyModule | AnyContract;

/** An entity of the normalised module shape: its definition plus the actions mounted on it. */
export interface AnyNormalisedEntity {
  readonly fields: ShapeFields;
  readonly history?: HistoryMode;
  readonly generated?: GeneratedOptions;
  readonly events?: EventShapes;
  readonly relations?: Relations;
  readonly actions?: Actions;
}

/** What a contribution or a conditional part adds to one entity. */
export interface AnyNormalisedPatch {
  readonly fields?: ShapeFields;
  readonly relations?: Relations;
  readonly actions?: Actions;
}

/** A contribution of the normalised shape: declaration and behaviour under one key (section 5.3). */
export interface AnyNormalisedContribution {
  readonly to: AnyModule;
  readonly when?: readonly Dependency[];
  readonly entities?: { readonly [entity: string]: AnyNormalisedPatch };
  readonly actions?: Actions;
}

/** A conditional part of the normalised shape (section 5.4). */
export interface AnyNormalisedConditional {
  readonly when: readonly Dependency[];
  readonly entities?: { readonly [entity: string]: AnyNormalisedPatch };
  readonly actions?: Actions;
}

/** The normalised module shape `defineModule` produces and `defineApp` consumes (section 4.7). */
export interface AnyModule {
  readonly kind: 'module';
  readonly id: string;
  readonly requires?: readonly Dependency[];
  readonly optional?: readonly Dependency[];
  readonly provides?: readonly AnyContract[];
  readonly generates?: readonly GeneratorTemplate[];
  readonly extensionPoints?: { readonly [name: string]: ExtensionPoint<unknown> };
  readonly entities?: { readonly [entity: string]: AnyNormalisedEntity };
  readonly actions?: Actions;
  readonly services?: { readonly [name: string]: object };
  readonly contributes?: readonly AnyNormalisedContribution[];
  readonly conditional?: readonly AnyNormalisedConditional[];
}
