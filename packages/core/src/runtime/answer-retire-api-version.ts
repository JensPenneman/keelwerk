import { repinRetiredPins } from '../api-versions/repin-retired-pins.ts';
import { retireVersion } from '../api-versions/retire-version.ts';
import type { ControlStore } from '../control/control-store.ts';
import type { ControlProvenance } from '../control/run-control-command.ts';
import type { ApiVersionRetirement } from '../core-module/api-version-retirement.ts';
import { errors } from '../errors/errors.ts';
import type { ServedApp } from './served-app.ts';

/**
 * `core.retireApiVersion`: `unavailable` when this process does not serve `input.app`;
 * `retireVersion(app.source.api, version, today)`, then `repinRetiredPins` for every pin that is
 * retired (each to its own target). `provenance` is the retire command's actor, request and command;
 * an abort of `signal` stops the re-pin between rows (a rerun finishes the rest).
 */
export async function answerRetireApiVersion(
  store: ControlStore,
  served: ReadonlyMap<string, ServedApp>,
  input: unknown,
  today: string,
  options: {
    readonly provenance?: ControlProvenance | undefined;
    readonly signal?: AbortSignal | undefined;
  } = {},
): Promise<ApiVersionRetirement> {
  const { app, version } = input as { readonly app: string; readonly version: string };
  const found = served.get(app);
  if (found === undefined) throw errors.unavailable(`The process does not serve app "${app}".`);
  const api = found.source.api;
  const { floor } = retireVersion(api, version, today);
  if (api === undefined || api === null)
    throw errors.internal('retireVersion accepted an app without API versions.');
  const { tenants, backends } = await repinRetiredPins(store, app, api, today, options);
  return { app, version, floor, tenants, backends };
}
