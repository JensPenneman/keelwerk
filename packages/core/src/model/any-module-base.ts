import type { AnyConditionDecl } from '../dsl/define-condition.ts';
import type { AnyContract } from '../dsl/define-contract.ts';
import type { AnyContributionDecl } from '../dsl/define-contribution.ts';
import type { AnyEntity } from '../dsl/define-entity.ts';
import type { AnyStreamDeclaration } from '../dsl/define-stream.ts';
import type { ExtensionMode, ExtensionPoint } from '../dsl/extension-point.ts';
import type { QuotaDimension } from '../dsl/quota.ts';
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
  readonly extensionPoints?: {
    readonly [name: string]: ExtensionPoint<unknown, ExtensionMode, boolean>;
  };
  /** The fields of the principal reference this module's resolver stores (decision 92). */
  readonly principalRef?: Shape;
  readonly entities?: { readonly [name: string]: AnyEntity };
  readonly streams?: { readonly [name: string]: AnyStreamDeclaration };
  readonly flags?: { readonly [name: string]: object };
  /** Quota dimensions the module declares (section 12.2). */
  readonly quotas?: { readonly [name: string]: QuotaDimension };
  /** 'all': the module's reactions may observe every event (G12). */
  readonly observes?: 'all';
  /** Who edits the module's configuration (section 5.7, G10). */
  readonly configAccess?: { readonly level: 'tenant'; readonly edit: 'policy' };
  /** A boolean flag of the module that gates its actions (section 20.6). */
  readonly gate?: string;
  readonly contributions?: { readonly [key: string]: AnyContributionDecl };
  readonly conditions?: { readonly [key: string]: AnyConditionDecl };
}
