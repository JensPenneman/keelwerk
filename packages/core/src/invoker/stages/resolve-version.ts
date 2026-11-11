import type { ChosenVersion } from '../../api-versions/resolve-version.ts';
import { resolveVersion as chooseVersion } from '../../api-versions/resolve-version.ts';
import type { Principal } from '../../principals/principal.ts';
import type { Carrier } from '../carrier.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import type { ResolvedScope } from '../resolved-scope.ts';

/**
 * `resolveVersion` (sections 9.2 and 18.3): the request's `Keelwerk-Version` header (a transport copies the query
 * parameter of a GET into it), else the credential's, else the
 * tenant's pin or the backend's default, else the app's head. The app's declared versions decide
 * which are known, retired or deprecated; an app that declares none serves its head only. A reaction
 * job always runs at the app's head.
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
    return { apiVersion: (app.api?.dates ?? [app.head]).at(-1) ?? app.head, deprecation: null };
  }
  return chooseVersion({
    dates: app.api?.dates ?? [app.head],
    versions: app.api?.versions ?? {},
    requested: carrier.headers?.['keelwerk-version'],
    credential: principal.apiVersion,
    pinned: resolved.pinnedVersion,
    today: env.options.clock.now().toZonedDateTimeISO('UTC').toPlainDate().toString(),
  });
}
