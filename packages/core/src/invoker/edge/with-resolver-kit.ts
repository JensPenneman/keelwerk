import type { ScopeRunner } from '../../interpreter/answer-deps.ts';
import { buildReadContext } from '../../interpreter/build-read-context.ts';
import { createRequestAnswerer } from '../../interpreter/create-request-answerer.ts';
import { dispatchRequest } from '../../interpreter/dispatch-request.ts';
import { driveHandler } from '../../interpreter/drive-handler.ts';
import type { RequestAuthorities } from '../../interpreter/request-authorities.ts';
import type { AnswerContext } from '../../kernel/answer-context.ts';
import type { Span } from '../../observability/span.ts';
import type { Principal } from '../../principals/principal.ts';
import type { Registry } from '../../registry/registry.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import type { ScopeTarget } from '../scope-target.ts';
import type { ResolverKit } from './resolver-kit.ts';

/** What the unit is opened for. */
export interface ResolverUnitInput {
  readonly env: InvokerEnv;
  readonly registry: Registry;
  readonly target: ScopeTarget;
  /** Where a load of a backend entity runs when the resolved scope is a tenant's; null when there is none. */
  readonly backendTarget: ScopeTarget | null;
  /** `ctx.config` of the resolvers' contexts (3.4). */
  readonly config: (module: string) => unknown;
  readonly transport: string;
  readonly requestId: string;
  readonly span: Span;
}

/**
 * Runs `fn` in a read-only unit of the resolved scope (S-24): the only unit a principal resolver
 * or enricher ever sees. Their loads are answered here with the authority of the module that
 * contributed them (section 17.2.4), and nothing is written.
 */
export function withResolverKit<T>(
  input: ResolverUnitInput,
  fn: (kit: ResolverKit) => Promise<T>,
): Promise<T> {
  const { env, registry, target } = input;
  const { adapter, capabilities } = target.handle;
  const { options } = env;
  const backendNamespace = (input.backendTarget ?? target).namespace;
  const concurrent = capabilities !== undefined && capabilities.processes !== 'single';
  const rules = env.rulesOf(registry);
  return adapter.unit(
    target.namespace,
    target.scope,
    async (unit) => {
      const authorities: RequestAuthorities = new WeakMap();
      const kits = new WeakMap<Principal, ReturnType<typeof contextsFor>>();
      const inScope: ScopeRunner = concurrent
        ? (_from, scope, run) =>
            adapter.unit(
              scope.level === 'backend' ? backendNamespace : target.namespace,
              scope,
              run,
              {
                readOnly: true,
              },
            )
        : (from, scope, run) => from.nested(run, { as: scope, readOnly: true });
      const contextsFor = (principal: Principal) => {
        const contexts = buildReadContext({
          registry,
          authorities,
          rules,
          principal,
          scope: target.scope,
          clock: options.clock,
          request: { transport: input.transport, requestId: input.requestId },
          config: input.config,
          log: options.log,
          trace: input.span,
        });
        const answerer = createRequestAnswerer({ rules, inScope, contexts, authorities });
        return { contexts, answerer };
      };
      const kitOf = (principal: Principal) => {
        const known = kits.get(principal);
        if (known !== undefined) return known;
        const built = contextsFor(principal);
        kits.set(principal, built);
        return built;
      };
      const kit: ResolverKit = {
        fills: (point, principal) => {
          const { contexts } = kitOf(principal);
          return (registry.fills.get(point) ?? []).flatMap((fill) => {
            const value =
              fill.bound && typeof fill.fill === 'function'
                ? (fill.fill as (own: unknown) => unknown)(contexts.forModule(fill.module))
                : fill.fill;
            return (Array.isArray(value) ? value : [value]).map((one) => ({
              module: fill.module,
              value: one,
            }));
          });
        },
        drive: async <R>(generator: unknown, module: string, principal: Principal) => {
          const { answerer } = kitOf(principal);
          const context: AnswerContext = {
            registry,
            unit,
            scope: target.scope,
            principal,
            module,
            form: 'read',
            clock: options.clock,
            keys: options.keys,
            compute: options.compute,
            log: options.log,
            flags: new Map(),
            answer: (request) => dispatchRequest(answerer, request, context),
            record: { read: () => undefined, answer: () => undefined, flag: () => undefined },
          };
          return (await driveHandler(generator, context.answer)) as R;
        },
      };
      return fn(kit);
    },
    { readOnly: true },
  );
}
