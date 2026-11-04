import type { ControlStore } from '../control/control-store.ts';
import { findControlRows } from '../control/find-control-rows.ts';
import { errors } from '../errors/errors.ts';
import type { Invocation } from '../invoker/invocation.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { Outcome } from '../invoker/outcome.ts';
import { compositionReport } from '../surface/composition-report.ts';
import { deriveSurface } from '../surface/derive-surface.ts';
import type { ServedApp } from './served-app.ts';

type Introspection = 'public' | 'operator' | undefined;

async function introspectionOf(store: ControlStore, backendId: string): Promise<Introspection> {
  const [row] = await findControlRows(store, 'core.backend', { id: backendId });
  const config = row?.config;
  if (typeof config !== 'object' || config === null) return undefined;
  const core = Reflect.get(config, 'core');
  const setting =
    typeof core === 'object' && core !== null ? Reflect.get(core, 'introspection') : undefined;
  return setting === 'public' || setting === 'operator' ? setting : undefined;
}

/**
 * Wraps the invoker so `core.introspect` and `core.composition` are answered from the app the
 * session runs in (16.2.5, 16.2.6; a deployment-scope session answers from the one app only when the process serves exactly one): the pipeline authorises them as any query, the handler is a
 * placeholder, and the answer replaces its output. The backend setting `config.core.introspection`
 * makes the surface `public` (anonymous callers too) or `operator` only; without it the rule of
 * the core module decides (any signed-in principal).
 */
export function answerRuntimeQueries(
  inner: Invoker,
  served: ReadonlyMap<string, ServedApp>,
  store: ControlStore,
): Invoker {
  return {
    ...inner,
    invoke: async <I, O>(inv: Invocation<I>): Promise<Outcome<O>> => {
      if (inv.action !== 'core.introspect' && inv.action !== 'core.composition') {
        return inner.invoke<I, O>(inv);
      }
      const opened =
        inv.session === undefined
          ? await inner.open(inv.carrier, { signal: inv.signal })
          : ({ ok: true, value: inv.session } as const);
      if (!opened.ok) return opened;
      const session = opened.value;
      const sole =
        served.size === 1 && session.app === 'core' ? [...served.values()][0] : undefined;
      const app = served.get(session.app) ?? sole;
      if (app === undefined) {
        return {
          ok: false,
          error: errors.unavailable(`The process does not serve app "${session.app}".`),
        };
      }
      const { principal, scope } = session;
      if (inv.action === 'core.introspect' && scope.level !== 'deployment') {
        const setting = await introspectionOf(store, scope.backendId);
        if (setting === 'operator' && principal.kind !== 'operator') {
          return { ok: false, error: errors.forbidden('The surface is for operators only.') };
        }
        if (setting === 'public' && principal.kind === 'anonymous') {
          return { ok: true, value: deriveSurface(app.source, session.apiVersion).surface as O };
        }
      }
      const outcome = await inner.invoke<I, O>({ ...inv, session });
      if (!outcome.ok) return outcome;
      const value =
        inv.action === 'core.introspect'
          ? deriveSurface(app.source, session.apiVersion).surface
          : compositionReport(app.source.registry);
      return { ...outcome, value: value as O };
    },
  };
}
