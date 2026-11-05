import type {
  DeploymentDefinition,
  Logger,
  ProcessRole,
  Runtime,
  RuntimeOptions,
} from '@keelwerk/core';
import { startRuntime } from '@keelwerk/core';
import { metrics, trace } from '@opentelemetry/api';
import type { BootedApp } from './booted-app.ts';
import type { BuiltHost, HostDeps } from './http-host-entry-of.ts';
import { httpHostEntryOf } from './http-host-entry-of.ts';
import { lateInvoker } from './late-invoker.ts';

/** What one process is started with. */
export interface BootOptions {
  readonly role: ProcessRole;
  readonly environment: NonNullable<RuntimeOptions['environment']>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly logger: Logger;
}

/**
 * Starts the process the deployment describes (section 3.3): `startRuntime` with listeners, and
 * the HTTP host the deployment lists, built over the runtime's invoker and opened after the
 * runtime is ready, so the TCP port and the operator socket accept nothing before the migrate
 * phase has finished. The runtime takes the host as an instance, so a deployment that lists the
 * `httpHost(...)` entry has it replaced by the instance it builds.
 */
export async function bootApp(
  definition: DeploymentDefinition,
  options: BootOptions,
): Promise<BootedApp> {
  const entry = httpHostEntryOf(definition.infrastructure);
  let runtime: Runtime | undefined;
  const socket = definition.operator?.socket;
  const deps: HostDeps | undefined =
    entry === undefined
      ? undefined
      : {
          invoker: lateInvoker(() => runtime?.invoker),
          surface: (appId, version) => {
            if (runtime === undefined) throw new Error('the runtime has not started yet');
            return runtime.surface(appId, version);
          },
          telemetry: { tracer: trace.getTracer('keelwerk'), meter: metrics.getMeter('keelwerk') },
          log: options.logger,
          ...(socket === undefined ? {} : { operator: { socket } }),
          development: options.environment === 'development',
        };
  const host: BuiltHost | undefined =
    entry === undefined || deps === undefined ? undefined : entry.create(deps);
  const infrastructure = definition.infrastructure.map((candidate) =>
    candidate === entry && entry !== undefined
      ? { kind: 'httpHost', provides: entry.provides, host }
      : candidate,
  );
  runtime = await startRuntime(
    { ...definition, infrastructure },
    {
      role: options.role,
      listen: true,
      environment: options.environment,
      env: options.env,
      logger: options.logger,
    },
  );
  const started = runtime;
  try {
    const listening = (await host?.listen()) ?? {};
    return {
      runtime: started,
      port: listening.port,
      operatorSocket: listening.operatorSocket,
      stop: async (deadlineMs) => {
        await host?.stop(deadlineMs);
        await started.stop(deadlineMs);
      },
    };
  } catch (error) {
    await started.stop(0).catch(() => undefined);
    throw error;
  }
}
