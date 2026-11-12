import { headApiVersion } from '../../api-versions/head-api-version.ts';
import type { ChosenVersion } from '../../api-versions/resolve-version.ts';
import { resolveVersion as chooseVersion } from '../../api-versions/resolve-version.ts';
import { servedTargetOf } from '../../api-versions/served-target-of.ts';
import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import type { Principal } from '../../principals/principal.ts';
import type { Carrier } from '../carrier.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import type { ResolvedScope } from '../resolved-scope.ts';

/**
 * `resolveVersion` (sections 9.2 and 18.3): the request's `Keelwerk-Version` header (a transport copies the query
 * parameter of a GET into it), else the credential's, else the
 * tenant's pin or the backend's default, else the app's head. The app's declared versions decide
 * which are known, retired or deprecated; an app that declares none serves its head only. A version
 * the request itself names (header, query parameter, hello) that is retired is refused. A version that
 * comes from a pin (the credential's, the tenant's or the backend's) and is retired is served under
 * its target (`servedTargetOf`, the version `surface retire` re-pins to), and the session says so, so
 * there is no outage between a sunset and the operator's retire. A reaction
 * job always runs at the app's head. Any other job (an async command, an enqueued job, a timer)
 * keeps the version it was accepted under even when that one is retired by the time the job runs,
 * with no deprecation: the job's input was stored in head form, so nothing is mistranslated, the
 * version is part of the fingerprint of the receipt the job takes over, and a command accepted
 * before the sunset is not lost to it.
 */
export function resolveVersion(
  env: InvokerEnv,
  resolved: ResolvedScope,
  carrier: Carrier,
  principal: Principal,
): ChosenVersion {
  const app = env.appOf(resolved.app);
  // A reaction job runs at the head of the build that runs it (7.7): the header, the credential's
  // pin and the tenant's or backend's pin are ignored, so a retired pin cannot fail the job.
  if (carrier.job?.reaction === true) {
    return { apiVersion: headApiVersion(app), deprecation: null };
  }
  const choice = {
    dates: app.api?.dates ?? [app.head],
    versions: app.api?.versions ?? {},
    requested: carrier.headers?.['keelwerk-version'],
    credential: principal.apiVersion,
    pinned: resolved.pinnedVersion,
    today: env.options.clock.now().toZonedDateTimeISO('UTC').toPlainDate().toString(),
  };
  try {
    return chooseVersion(choice);
  } catch (error) {
    if (!(error instanceof KeelwerkError && error.code === 'core.api_version_retired')) throw error;
    const pin = choice.credential ?? choice.pinned;
    if (carrier.job !== undefined) {
      const kept = choice.requested ?? pin;
      return { apiVersion: kept ?? headApiVersion(app), deprecation: null };
    }
    if (choice.requested === undefined && pin !== undefined && app.api !== undefined) {
      return chooseVersion({
        ...choice,
        credential: undefined,
        pinned: servedTargetOf(app.api, pin, choice.today),
      });
    }
    throw error;
  }
}
