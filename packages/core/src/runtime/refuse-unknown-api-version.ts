import { resolveVersion } from '../api-versions/resolve-version.ts';
import type { ControlStore } from '../control/control-store.ts';
import { findControlRows } from '../control/find-control-rows.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { Invocation } from '../invoker/invocation.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { Outcome } from '../invoker/outcome.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ServedApp } from './served-app.ts';

const action = 'core.tenant.setApiVersion';

async function refusal(
  input: unknown,
  principalKind: string,
  served: ReadonlyMap<string, ServedApp>,
  store: ControlStore,
  clock: Clock,
): Promise<KeelwerkError | undefined> {
  if (principalKind !== 'operator' || typeof input !== 'object' || input === null) return undefined;
  const id: unknown = Reflect.get(input, 'id');
  const version: unknown = Reflect.get(input, 'apiVersion');
  if (typeof id !== 'string' || typeof version !== 'string') return undefined;
  const [tenant] = await findControlRows(store, 'core.tenant', { id });
  const backendId: unknown = tenant?.backendId;
  if (typeof backendId !== 'string') return undefined;
  const [backend] = await findControlRows(store, 'core.backend', { id: backendId });
  const app = served.get(String(backend?.app));
  if (app === undefined) {
    return errors.unavailable(
      `This process does not serve the app of the tenant, so it cannot check "${version}".`,
    );
  }
  const dates = app.source.api?.dates;
  if (dates === undefined) return undefined;
  if (!dates.includes(version)) {
    return errors.validation(
      `"${version}" is not an API version of "${app.id}"; the known versions are ${dates.join(', ')}.`,
    );
  }
  // A version past its sunset is retired (S-78): a pin to it would fail every request.
  try {
    resolveVersion({
      dates,
      versions: app.source.api?.versions ?? {},
      requested: version,
      today: clock.now().toZonedDateTimeISO('UTC').toPlainDate().toString(),
    });
  } catch (error) {
    if (error instanceof KeelwerkError) return error;
    throw error;
  }
  return undefined;
}

/**
 * Wraps the invoker so `core.tenant.setApiVersion` refuses a version the tenant's app does not
 * declare (S-78), the check `createTenant` runs: the command itself cannot see the app's
 * versions. Only an operator is told which versions exist; any other caller meets the command's
 * own refusal. An app that declares no versions accepts any date, as `createTenant` does.
 */
export function refuseUnknownApiVersion(
  inner: Invoker,
  served: ReadonlyMap<string, ServedApp>,
  store: ControlStore,
  clock: Clock,
): Invoker {
  return {
    ...inner,
    invoke: async <I, O>(inv: Invocation<I>): Promise<Outcome<O>> => {
      if (inv.action !== action) return inner.invoke<I, O>(inv);
      const opened =
        inv.session === undefined
          ? await inner.open(inv.carrier, { signal: inv.signal })
          : ({ ok: true, value: inv.session } as const);
      if (!opened.ok) return opened;
      const session = opened.value;
      const refused = await refusal(inv.input, session.principal.kind, served, store, clock);
      if (refused !== undefined) return { ok: false, error: refused };
      return inner.invoke<I, O>({ ...inv, session });
    },
  };
}
