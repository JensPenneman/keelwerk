import { type ApiSurface, toWire } from '@keelwerk/core';
import { audienceOf } from '@keelwerk/core/http';
import { type AnyTRPCRouter, initTRPC } from '@trpc/server';
import { checkTrpcSurface } from '../check/check-trpc-surface.ts';
import { keelwerkErrorOfTrpc } from '../errors/keelwerk-error-of-trpc.ts';
import type { TrpcErrorShape } from '../errors/trpc-error-shape.ts';
import { keelwerkSuperjson } from '../transformer/keelwerk-superjson.ts';
import type { TrpcStaticOptions } from '../trpc-static-options.ts';
import { invokeProcedure } from './invoke-procedure.ts';
import { isTrpcExposed } from './is-trpc-exposed.ts';
import { subscribeProcedure } from './subscribe-procedure.ts';
import type { TrpcContext } from './trpc-context.ts';
import { trpcPathOf } from './trpc-path-of.ts';

/** A level of the router's record: a procedure, or the members of a nested router. */
interface Level {
  readonly [name: string]: unknown;
}

/** The nested records of the router, one per path segment: no object of one level is shared with another. */
function recordOf(entries: readonly (readonly [readonly string[], unknown])[]): Level {
  const groups = new Map<string, (readonly [readonly string[], unknown])[]>();
  for (const [path, leaf] of entries) {
    const [head = '', ...rest] = path;
    const group = groups.get(head) ?? [];
    group.push([rest, leaf]);
    groups.set(head, group);
  }
  return Object.fromEntries(
    [...groups].map(([name, group]) => {
      const [only] = group;
      return [name, only?.[0].length === 0 ? only[1] : recordOf(group)];
    }),
  );
}

/**
 * The router of one surface (section 16.7.1): one procedure per exposed action, nested by module,
 * entity and action name. Procedures do not validate: they pass the raw input to the invoker, whose
 * pipeline validates once. The first problem of the tRPC check is thrown, so a surface the check
 * refuses never builds. The transformer, the error formatter (the wire error as `data.keelwerk`) and
 * the SSE ping are set here; `development` selects the error audience.
 */
export function buildTrpcRouter(
  surface: ApiSurface,
  options: TrpcStaticOptions,
  development: boolean,
): AnyTRPCRouter {
  const refused = checkTrpcSurface(surface)[0];
  if (refused !== undefined) {
    throw new TypeError(
      `${refused.code}: ${refused.subject}: ${refused.message} (API version ${surface.apiVersion})`,
    );
  }
  const t = initTRPC
    .context<TrpcContext>()
    .meta<{ ref: string }>()
    .create({
      ...(options.transformer === 'json' ? {} : { transformer: keelwerkSuperjson() }),
      isDev: false,
      errorFormatter: ({ shape, error, ctx }): TrpcErrorShape => {
        const cause = keelwerkErrorOfTrpc(error);
        const wire = toWire(
          cause,
          ctx === undefined
            ? development
              ? 'development'
              : 'public'
            : audienceOf(ctx.session, development),
        );
        return {
          message: wire.message,
          code: shape.code,
          data: {
            code: shape.data.code,
            httpStatus: shape.data.httpStatus,
            ...(shape.data.path === undefined ? {} : { path: shape.data.path }),
            keelwerk: { ...wire, requestId: ctx?.requestId ?? '' },
          },
        };
      },
      sse: { ping: { enabled: true, intervalMs: 15_000 }, maxDurationMs: 86_400_000 },
    });
  const never = new AbortController().signal;
  const entries = surface.actions.filter(isTrpcExposed).map((action) => {
    const base = t.procedure.meta({ ref: action.ref }).input((raw: unknown) => raw);
    const procedure =
      action.kind === 'query'
        ? base.query(({ ctx, input, signal }) =>
            invokeProcedure(ctx, action, input, signal ?? never),
          )
        : action.kind === 'command'
          ? base.mutation(({ ctx, input, signal }) =>
              invokeProcedure(ctx, action, input, signal ?? never),
            )
          : base.subscription(({ ctx, input, signal }) =>
              subscribeProcedure(ctx, action, input, signal ?? never),
            );
    return [trpcPathOf(action), procedure] as const;
  });
  return t.router(recordOf(entries) as Parameters<typeof t.router>[0]);
}
