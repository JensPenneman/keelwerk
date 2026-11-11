import { createAbility } from '../authorization/create-ability.ts';
import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { FlagSnapshot } from '../flags/flag-snapshot.ts';
import type { RequestInfo } from '../invoker/request-info.ts';
import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import type { Span } from '../observability/span.ts';
import type { Principal } from '../principals/principal.ts';
import type { AllRequest } from '../protocol/all-request.ts';
import type { AskRequest } from '../protocol/ask-request.ts';
import type { ComputeRequest } from '../protocol/compute-request.ts';
import type { FlagRequest } from '../protocol/flag-request.ts';
import type { SecretRequest } from '../protocol/secret-request.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { ModuleEntry } from '../registry/module-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import { bindExtensionValues } from './bind-extension-values.ts';
import { bindServices } from './bind-services.ts';
import { buildEntityLoads } from './build-entity-loads.ts';
import { buildLoadConstructors } from './build-load-constructors.ts';
import type { ContextFactory } from './context-factory.ts';
import { createRequest } from './create-request.ts';
import { principalContextOf } from './principal-context-of.ts';
import { refuseRequest } from './refuse-request.ts';
import type { RequestAuthorities } from './request-authorities.ts';

/** What the contexts of one invocation are built from. */
export interface ReadContextInput {
  readonly registry: Registry;
  readonly rules: readonly NormalizedRule[];
  readonly principal: Principal;
  readonly scope: Scope;
  readonly clock: Clock;
  readonly request: RequestInfo;
  /** The module's configuration (section 3.4); `undefined` for a module without any. */
  readonly config: (module: string) => unknown;
  readonly log: Logger;
  readonly trace: Span;
  /** Where the requests of the contexts are recorded with the module that built them; the answerers read the same map. */
  readonly authorities: RequestAuthorities;
  /** The invocation's flag snapshot; rules read it through the principal context. */
  readonly flags?: FlagSnapshot | undefined;
  /** The invoked action: `ctx.target` of its module is its entity's loads through its plan. */
  readonly action?: ActionEntry;
}

/**
 * Builds the `ReadContext` of every module a part may run for (section 7.6): scope, principal,
 * ability, configuration, the invocation's clock, request metadata, loads, flag requests, bound
 * services and extension values, reveal and verify, computations, `ask`, `all`, `log` and
 * `trace`; and `target` in the invoked action's own module. Ids, random values, issued secrets
 * and the write side do not exist here. A context is a frozen value; `load`, `services`,
 * `extensions` and `ability` are computed on first use and cached per context; `flags` and
 * `flagDetails` reach the module's own flags and those of the modules it requires (7.6).
 */
export function buildReadContext(input: ReadContextInput): ContextFactory {
  const { registry, authorities } = input;
  const contexts = new Map<string, Readonly<Record<string, unknown>>>();

  const flagRequest = (key: string, details: boolean): FlagRequest =>
    createRequest<FlagRequest>(authorities, { kind: 'flag', key, details });

  const build = (module: ModuleEntry, scope: Scope): Readonly<Record<string, unknown>> => {
    const principalContext = principalContextOf(registry, input.principal, scope, input.flags);
    const contextOf = (id: string) => factory.forModule(id, scope);
    const compute = (op: ComputeRequest['op'], ...args: readonly unknown[]): ComputeRequest =>
      createRequest<ComputeRequest>(authorities, {
        kind: 'compute',
        op,
        args: Object.freeze([...args]),
      });
    const secret = (op: SecretRequest['op'], ...args: readonly unknown[]): SecretRequest =>
      createRequest<SecretRequest>(
        authorities,
        { kind: 'secret', op, args: Object.freeze([...args]) },
        module.id,
      );
    const flags: Record<string, Record<string, FlagRequest>> = {};
    const flagKeys = new Set<string>();
    for (const id of [module.id, ...module.requires]) {
      const owner = registry.modules.find((entry) => entry.id === id);
      if (owner === undefined) continue;
      const own: Record<string, FlagRequest> = {};
      for (const name of Object.keys(owner.flags)) {
        flagKeys.add(`${owner.id}.${name}`);
        own[name] = flagRequest(`${owner.id}.${name}`, false);
      }
      if (Object.keys(own).length > 0) flags[owner.contextName] = Object.freeze(own);
    }
    Object.freeze(flags);
    const target =
      input.action?.entity !== undefined && input.action.module === module.id
        ? registry.entities.get(input.action.entity)
        : undefined;
    let ability: ReturnType<typeof createAbility> | undefined;
    let load: Readonly<Record<string, unknown>> | undefined;
    let services: Readonly<Record<string, unknown>> | undefined;
    let extensions: Readonly<Record<string, unknown>> | undefined;
    return Object.freeze({
      scope,
      principal: input.principal,
      get ability() {
        ability ??= createAbility({ registry, context: principalContext, rules: input.rules });
        return ability;
      },
      config: input.config(module.id),
      clock: input.clock,
      request: input.request,
      get load() {
        load ??= buildLoadConstructors(registry, module, authorities);
        return load;
      },
      flags,
      flagDetails: (key: string) => {
        if (!flagKeys.has(key)) {
          throw refuseRequest(
            'flag',
            `"${key}" is not a flag of "${module.id}" or its requirements`,
          );
        }
        return flagRequest(key, true);
      },
      get services() {
        services ??= bindServices(registry, module, contextOf, authorities);
        return services;
      },
      get extensions() {
        extensions ??= bindExtensionValues(registry, module, contextOf);
        return extensions;
      },
      secrets: Object.freeze({
        reveal: (ref: unknown, reason: string) => secret('reveal', ref, reason),
        verify: (token: string, verifier: string) => secret('verify', token, verifier),
      }),
      compute: Object.freeze({
        argon2idHash: (password: string, salt: Uint8Array) =>
          compute('argon2idHash', password, salt),
        argon2idVerify: (verifier: string, password: string) =>
          compute('argon2idVerify', verifier, password),
        argon2idNeedsRehash: (verifier: string) => compute('argon2idNeedsRehash', verifier),
      }),
      ask: (ref: string, askInput: unknown) =>
        createRequest<AskRequest>(authorities, { kind: 'ask', ref, input: askInput }, module.id),
      all: (requests: readonly unknown[]) =>
        createRequest<AllRequest>(authorities, {
          kind: 'all',
          requests: Object.freeze(
            requests.map((request) => {
              if (typeof request !== 'object' || request === null || !('kind' in request)) {
                throw refuseRequest('all', 'every member must be a request');
              }
              return request as AllRequest['requests'][number];
            }),
          ),
        }),
      log: input.log,
      trace: input.trace,
      ...(target === undefined
        ? {}
        : { target: buildEntityLoads(target, 'caller', module.id, authorities) }),
    });
  };

  const factory: ContextFactory = {
    forModule(id, scope = input.scope) {
      const key = `${id}\u0000${JSON.stringify(scope)}`;
      const known = contexts.get(key);
      if (known !== undefined) return known;
      const module = registry.modules.find((entry) => entry.id === id);
      if (module === undefined) {
        throw new KeelwerkError({
          kind: 'internal',
          code: 'core.internal',
          message: `Module "${id}" is not part of this app.`,
        });
      }
      const context = build(module, scope);
      contexts.set(key, context);
      return context;
    },
  };
  return factory;
}
