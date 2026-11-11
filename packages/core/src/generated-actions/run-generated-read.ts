import { normalizeRule } from '../authorization/normalize-rule.ts';
import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { FlagSnapshot } from '../flags/flag-snapshot.ts';
import type { Principal } from '../principals/principal.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Scope } from '../storage/scope.ts';
import { registerGeneratedActions } from './register-generated-actions.ts';

/** What a generated read runs with; the invoker has authorized the call and validated `input`. */
export interface RunGeneratedReadInput {
  readonly registry: Registry;
  readonly adapter: DataAdapter;
  readonly namespace: NamespaceRef;
  readonly scope: Scope;
  readonly action: ActionEntry;
  readonly input: unknown;
  readonly principal: Principal;
  /** Normalised rules after the policy overrides; default: the registry's. */
  readonly rules?: readonly NormalizedRule[];
  /** The scope's epoch (section 15.2.6); default 0, the epoch of a scope whose positions never restarted. */
  readonly epoch?: number;
  /** The invocation's flag snapshot; absent: declared defaults. */
  readonly flags?: FlagSnapshot | undefined;
  readonly signal?: AbortSignal;
}

/**
 * Runs a generated read in a read-only unit of the scope. The head position is the unit's first
 * statement, so the `state` a read returns describes the snapshot its rows come from (section
 * 15.2.6); the implementation of the action's `generated` marker does the rest.
 */
export async function runGeneratedRead(input: RunGeneratedReadInput): Promise<unknown> {
  const { registry, action } = input;
  const read =
    action.generated === undefined ? undefined : registerGeneratedActions().reads[action.generated];
  const entry = action.entity === undefined ? undefined : registry.entities.get(action.entity);
  if (read === undefined || entry === undefined) {
    throw new KeelwerkError({
      kind: 'not_implemented',
      code: 'core.not_implemented',
      message: `"${action.ref}" is not served by this release.`,
    });
  }
  const rules =
    input.rules ??
    [...registry.rules.values()].filter((rule) => rule.disabled !== true).map(normalizeRule);
  input.signal?.throwIfAborted();
  return input.adapter.unit(
    input.namespace,
    input.scope,
    async (unit) => {
      if (unit.scope.level === 'namespace')
        throw errors.internal('a read ran in a namespace scope');
      const head = (await unit.events.head()) ?? 0n;
      return read({
        unit,
        registry,
        entry,
        action,
        principal: input.principal,
        rules,
        tokens: {
          registry,
          rules,
          principal: input.principal,
          epoch: input.epoch ?? 0,
          flags: input.flags,
        },
        scope: unit.scope,
        input: input.input,
        head,
      });
    },
    { readOnly: true, ...(input.signal === undefined ? {} : { signal: input.signal }) },
  );
}
