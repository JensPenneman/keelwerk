import type { ActionMap, PolicyMap, RuntimeModule } from './runtime-module.ts';

const none: ActionMap = {};

/** One behaviour section of a module literal: the top level, a contribution or a conditional part. */
export interface BehaviourSection {
  /** For messages: the module id, 'auth->accounts' or 'auth[whenAccounts]'. */
  readonly label: string;
  readonly policies: PolicyMap;
  readonly actions: ActionMap;
  readonly entityActions: (entity: string) => ActionMap;
}

/** The sections `defineModule` checks rules against (decision 105), whether or not they are active. */
export function behaviourSections(module: RuntimeModule): readonly BehaviourSection[] {
  return [
    {
      label: module.id,
      policies: module.policies,
      actions: module.actions,
      entityActions: (entity) => module.entities[entity]?.actions ?? none,
    },
    ...module.contributes.map((contribution) => ({
      label: `${module.id}->${contribution.to.id}`,
      policies: contribution.policies,
      actions: contribution.actions,
      entityActions: (entity: string) => contribution.entities[entity]?.actions ?? none,
    })),
    ...module.conditional.map((conditional) => ({
      label: `${module.id}[${conditional.key}]`,
      policies: conditional.policies,
      actions: conditional.actions,
      entityActions: (entity: string) => conditional.entities[entity]?.actions ?? none,
    })),
  ];
}
