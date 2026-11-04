import type { AnyConditionDecl } from '../dsl/define-condition.ts';
import type { AnyContract } from '../dsl/define-contract.ts';
import type { AnyContributionDecl } from '../dsl/define-contribution.ts';
import type { AnyEntity } from '../dsl/define-entity.ts';
import type { ExtensionPoint } from '../dsl/extension-point.ts';
import type { Shape } from '../fields/shape.ts';
import type { Dependency } from './any-module.ts';
import type { GeneratorTemplate } from './generator-template.ts';

/** The module base: everything a handler's types depend on (section 4.1). */
export interface AnyModuleBase {
  readonly id: string;
  readonly version: string;
  readonly requires?: readonly Dependency[];
  readonly optional?: readonly Dependency[];
  readonly provides?: readonly AnyContract[];
  readonly generates?: readonly GeneratorTemplate[];
  readonly config?: Shape;
  readonly data?: {
    readonly needs?: readonly unknown[];
    readonly sql?: 'postgres' | 'mysql' | 'sqlite';
  };
  readonly extensionPoints?: { readonly [name: string]: ExtensionPoint<unknown> };
  /** The fields of the principal reference this module's resolver stores (decision 92). */
  readonly principalRef?: Shape;
  readonly entities?: { readonly [name: string]: AnyEntity };
  readonly streams?: { readonly [name: string]: object };
  readonly flags?: { readonly [name: string]: object };
  readonly contributions?: { readonly [key: string]: AnyContributionDecl };
  readonly conditions?: { readonly [key: string]: AnyConditionDecl };
}
