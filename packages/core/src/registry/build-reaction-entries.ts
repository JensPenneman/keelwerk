import type { JobRetry } from '../jobs/job-retry.ts';
import type { ActionHandler } from './action-handler.ts';
import type { AppliedPart } from './applied-part.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { ReactionEntry } from './reaction-entry.ts';
import { resolvePartReference } from './resolve-part-references.ts';
import type { PartMap, RuntimeModule } from './runtime-module.ts';

interface ReactionSpecView {
  readonly on: string | readonly string[];
  readonly except?: readonly string[];
  readonly events?: { readonly [name: string]: unknown };
  readonly initial?: unknown;
  readonly evolve?: ActionHandler;
  readonly timing?: 'inline' | 'async';
  readonly key?: ReactionEntry['key'];
  readonly ordering?: ReactionEntry['ordering'];
  readonly coalesce?: boolean;
  readonly concurrency?: number;
  readonly retry?: JobRetry;
  readonly react: ActionHandler;
}

function entriesOf(
  reactions: PartMap,
  module: string,
  prefix: string,
  when: readonly string[],
  contributedBy: string | undefined,
): readonly ReactionEntry[] {
  return Object.entries(reactions).map(([key, part]) => {
    const spec = Reflect.get(part, 'spec') as ReactionSpecView;
    const base = {
      id: resolvePartReference(part) ?? `${prefix}.${key}`,
      module,
      ...(spec.key === undefined ? {} : { key: spec.key }),
      ...(spec.concurrency === undefined ? {} : { concurrency: spec.concurrency }),
      ...(spec.retry === undefined ? {} : { retry: spec.retry }),
      react: spec.react,
      when,
      ...(contributedBy === undefined ? {} : { contributedBy }),
    };
    if (Reflect.get(part, 'kind') === 'process') {
      return {
        ...base,
        on: spec.on as readonly string[],
        timing: 'async',
        ordering: 'fifo-per-key',
        coalesce: false,
        process: true,
        ...(spec.evolve === undefined ? {} : { evolve: spec.evolve }),
        initial: spec.initial,
        events: Object.keys(spec.events ?? {}),
      } satisfies ReactionEntry;
    }
    return {
      ...base,
      on: spec.on === 'all' ? 'all' : [spec.on as string],
      ...(spec.except === undefined ? {} : { except: spec.except }),
      timing: spec.timing ?? 'async',
      ordering: spec.ordering ?? 'none',
      coalesce: spec.coalesce ?? false,
      process: false,
    } satisfies ReactionEntry;
  });
}

/** The reactions by id and the problems met. */
export interface BuiltReactions {
  readonly reactions: ReadonlyMap<string, ReactionEntry>;
  readonly problems: readonly CompositionProblem[];
}

/**
 * The reactions of the modules (section 7.7): the modules' own, and those of active contributions
 * and conditional parts, which carry the modules whose presence activates them. `timing` defaults
 * to 'async', which M1 refuses (S-24).
 */
export function buildReactionEntries(
  ordered: readonly RuntimeModule[],
  parts: readonly AppliedPart[],
): BuiltReactions {
  const reactions = new Map<string, ReactionEntry>();
  const problems: CompositionProblem[] = [];
  const add = (entries: readonly ReactionEntry[]): void => {
    for (const entry of entries) {
      if (reactions.has(entry.id)) {
        problems.push(
          compositionError('duplicateReactions', `The reaction '${entry.id}' is mounted twice.`, {
            module: entry.module,
            ref: entry.id,
          }),
        );
      } else reactions.set(entry.id, entry);
    }
  };
  for (const module of ordered)
    add(entriesOf(module.reactions, module.id, module.id, [], undefined));
  for (const part of parts) {
    if (!part.active) continue;
    add(
      entriesOf(
        part.reactions,
        part.declaredBy.id,
        part.target,
        part.whenNames,
        part.declaredBy.id,
      ),
    );
  }
  return { reactions, problems };
}
