import type { ApiSurface } from '@keelwerk/core';
import type { Application } from '@stricli/core';
import { buildApplication, buildRouteMap } from '@stricli/core';
import { cliText } from './cli-text.ts';
import { backendRoutes } from './commands/backend/backend-routes.ts';
import { buildRoutes } from './commands/build/build-routes.ts';
import { callRoutes } from './commands/call/call-routes.ts';
import { completionRoutes } from './commands/completion/completion-routes.ts';
import { consumersRoutes } from './commands/consumers/consumers-routes.ts';
import { dbRoutes } from './commands/db/db-routes.ts';
import { devRoutes } from './commands/dev/dev-routes.ts';
import { doctorRoutes } from './commands/doctor/doctor-routes.ts';
import { explainRoutes } from './commands/explain/explain-routes.ts';
import { flagsRoutes } from './commands/flags/flags-routes.ts';
import { generateRoutes } from './commands/generate/generate-routes.ts';
import { initRoutes } from './commands/init/init-routes.ts';
import { introspectRoutes } from './commands/introspect/introspect-routes.ts';
import { jobsRoutes } from './commands/jobs/jobs-routes.ts';
import { loginRoutes } from './commands/login/login-routes.ts';
import { newRoutes } from './commands/new/new-routes.ts';
import { operatorRoutes } from './commands/operator/operator-routes.ts';
import { profileRoutes } from './commands/profile/profile-routes.ts';
import { startRoutes } from './commands/start/start-routes.ts';
import { surfaceRoutes } from './commands/surface/surface-routes.ts';
import { tenantRoutes } from './commands/tenant/tenant-routes.ts';
import type { CliContext } from './context/cli-context.ts';
import { determineExitCode } from './determine-exit-code.ts';
import type { ActionRoutesOptions } from './routes/build-action-routes.ts';
import { version } from './version.ts';

/**
 * The `keelwerk` application (section 16.9.2): the action routes under `call` come from the
 * surface, every other command group contributes the routes of its own file.
 */
export function buildCliApp(
  surface: ApiSurface | undefined,
  options: ActionRoutesOptions = {},
): Application<CliContext> {
  const root = buildRouteMap<string, CliContext>({
    routes: {
      ...callRoutes(surface, options),
      ...profileRoutes,
      ...completionRoutes,
      ...loginRoutes,
      ...backendRoutes,
      ...tenantRoutes,
      ...operatorRoutes,
      ...introspectRoutes,
      ...dbRoutes,
      ...surfaceRoutes,
      ...explainRoutes,
      ...initRoutes,
      ...newRoutes,
      ...generateRoutes,
      ...buildRoutes,
      ...startRoutes,
      ...devRoutes,
      ...doctorRoutes,
      ...jobsRoutes,
      ...consumersRoutes,
      ...flagsRoutes,
    },
    docs: { brief: 'Build, run and operate keelwerk applications.' },
  });
  return buildApplication(root, {
    name: 'keelwerk',
    versionInfo: { currentVersion: version },
    scanner: { caseStyle: 'original', allowArgumentEscapeSequence: true },
    documentation: { caseStyle: 'original' },
    determineExitCode,
    localization: { loadText: () => cliText },
  });
}
