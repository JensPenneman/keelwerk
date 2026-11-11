import type { FlagResolution } from '../contexts/flag-resolution.ts';
import type { FlagRead } from '../events/flag-read.ts';
import type { Logger } from '../observability/logger.ts';
import type { Principal } from '../principals/principal.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import { compileGate } from './compile-gate.ts';
import { defaultFlagResolution } from './default-flag-resolution.ts';
import { flagContextOf } from './flag-context-of.ts';
import type { FlagProvider } from './flag-provider.ts';
import type { FlagSnapshot } from './flag-snapshot.ts';
import type { FlagSpec } from './flag-spec.ts';
import { flagSpecOf } from './flag-spec-of.ts';
import { resolveFlag } from './resolve-flag.ts';

function noop(): void {}

/** A synchronous provider as the lazy path asks it: a promise from it is a failure, never awaited. */
function strictlySynchronous(provider: FlagProvider): FlagProvider {
  return {
    id: provider.id,
    sync: true,
    start: (signal) => provider.start(signal),
    resolve: (flag, context) => {
      const answer = provider.resolve(flag, context);
      if (typeof answer === 'object' && answer !== null && 'then' in answer) {
        (answer as Promise<unknown>).catch(noop);
        throw new Error(`The flag provider "${provider.id}" declares sync and returned a promise.`);
      }
      return answer;
    },
  };
}

/** The flags the invoked module's contexts can read (7.6), plus the keys of the action's gates. */
function keysToResolve(registry: Registry, action: ActionEntry): readonly string[] {
  const owner = registry.modules.find(
    (entry) => entry.id === (action.contributedBy ?? action.module),
  );
  const keys = new Set<string>();
  for (const id of [owner?.id, ...(owner?.requires ?? [])]) {
    const module = registry.modules.find((entry) => entry.id === id);
    for (const name of Object.keys(module?.flags ?? {})) keys.add(`${module?.id}.${name}`);
  }
  for (const gate of compileGate(registry, action)) keys.add(gate.key);
  return [...keys];
}

/** What one invocation's snapshot is built from. */
export interface BuildSnapshotInput {
  readonly registry: Registry;
  readonly action: ActionEntry;
  readonly scope: Scope;
  readonly principal: Principal;
  /** flagClientIdOf(invocation.carrier). */
  readonly clientId: string | null;
  readonly providers: readonly FlagProvider[];
  /** Warns once per key a provider failed for (the default was served with ERROR). */
  readonly log: Logger;
}

/**
 * One snapshot per invocation (20.3). While every provider is synchronous a key resolves on its
 * first read and is kept, so a flag that flips afterwards is not seen. With an asynchronous
 * provider the flags of the invoked module, the modules it requires and the action's gates are
 * resolved before the snapshot is answered, and a later read of another key serves its default
 * with `ERROR`/`GENERAL`. A key no module declares answers `FLAG_NOT_FOUND` and is not listed in
 * `evaluations`.
 */
export async function buildSnapshot(input: BuildSnapshotInput): Promise<FlagSnapshot> {
  const { registry, providers } = input;
  const resolved = new Map<string, FlagResolution<unknown>>();
  const evaluations: FlagRead[] = [];
  const listed = new Set<string>();
  const warned = new Set<string>();
  const lazyProviders = providers.map(strictlySynchronous);
  const asynchronous = providers.some((provider) => !provider.sync);

  const resolution = (
    spec: FlagSpec,
    chain: readonly FlagProvider[],
  ): FlagResolution<unknown> | Promise<FlagResolution<unknown>> =>
    resolveFlag(
      chain,
      spec,
      flagContextOf(spec.level, {
        scope: input.scope,
        principal: input.principal,
        clientId: input.clientId,
      }),
      (provider, error) => {
        if (warned.has(spec.key)) return;
        warned.add(spec.key);
        input.log.warn('a flag provider failed; the declared default was served', {
          flag: spec.key,
          provider,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );

  if (asynchronous) {
    const specs = keysToResolve(registry, input.action).flatMap((key) => {
      const spec = flagSpecOf(registry, key);
      return spec === undefined ? [] : [spec];
    });
    const answers = await Promise.all(specs.map((spec) => resolution(spec, providers)));
    specs.forEach((spec, index) => {
      const answer = answers[index];
      if (answer !== undefined) resolved.set(spec.key, answer);
    });
  }

  return {
    read: <T>(key: string): FlagResolution<T> => {
      const spec = flagSpecOf(registry, key);
      if (spec === undefined) {
        return {
          value: undefined as T,
          variant: 'default',
          reason: 'ERROR',
          errorCode: 'FLAG_NOT_FOUND',
          provider: 'default',
        };
      }
      let answer = resolved.get(key);
      if (answer === undefined) {
        answer = asynchronous
          ? defaultFlagResolution(spec, { errorCode: 'GENERAL' })
          : (resolution(spec, lazyProviders) as FlagResolution<unknown>);
        resolved.set(key, answer);
      }
      if (!listed.has(key)) {
        listed.add(key);
        evaluations.push({
          key,
          variant: answer.variant,
          reason: answer.reason,
          ruleVersion: answer.ruleVersion ?? null,
        });
      }
      return answer as FlagResolution<T>;
    },
    get evaluations(): readonly FlagRead[] {
      return evaluations;
    },
  };
}
