import { context, metrics, trace } from '@opentelemetry/api';
import { errors } from '../errors/errors.ts';
import type { Logger } from '../observability/logger.ts';
import type { DeploymentDefinition } from './deployment-definition.ts';

type Flush = (deadlineMs: number) => Promise<void>;

/** What the process keeps of its one registration, on `globalThis` (open point 460). */
interface Registration {
  readonly endpoint: string;
  readonly flush: Flush;
  /** Settles when the exporters are registered. */
  readonly ready: Promise<void>;
}

const registrationKey = Symbol.for('keelwerk.telemetry');
const noFlush: Flush = async () => undefined;

function kept(): Registration | undefined {
  const held: unknown = Reflect.get(globalThis, registrationKey);
  return typeof held === 'object' && held !== null ? (held as Registration) : undefined;
}

/** The endpoint and where it was named: `undefined` when the deployment asks for no export. */
function endpointOf(
  otlp: unknown,
  env: Readonly<Record<string, string | undefined>>,
): { readonly endpoint: string; readonly source: string } | undefined {
  if (otlp === undefined) return undefined;
  if (typeof otlp === 'string')
    return otlp === '' ? undefined : { endpoint: otlp, source: 'telemetry.otlp' };
  if (
    typeof otlp === 'object' &&
    otlp !== null &&
    Reflect.get(otlp, 'kind') === 'env' &&
    typeof Reflect.get(otlp, 'name') === 'string'
  ) {
    const name = Reflect.get(otlp, 'name') as string;
    const value = env[name];
    return value === undefined || value === ''
      ? undefined
      : { endpoint: value, source: `the variable ${name}` };
  }
  throw errors.validation('telemetry.otlp is a URL or env(...).');
}

function checkedUrl(endpoint: string, source: string): string {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw errors.validation(`telemetry.otlp (${source}) is not a URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw errors.validation(`telemetry.otlp (${source}) is not an http or https URL.`);
  }
  // Trailing slashes are cut without a regular expression: a pattern like /\/+$/ takes quadratic
  // time on a long run of slashes.
  let end = endpoint.length;
  while (end > 0 && endpoint.charCodeAt(end - 1) === 47) end -= 1;
  return endpoint.slice(0, end);
}

/** Races `work` against the deadline; a failure or the deadline is logged as a warning. */
async function bounded(work: Promise<unknown>, deadlineMs: number, log: Logger): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => resolve('deadline'), deadlineMs);
    timer.unref();
  });
  try {
    const outcome = await Promise.race([work.then(() => 'flushed' as const), deadline]);
    if (outcome === 'deadline') {
      log.warn('telemetry was not flushed before the stop deadline', { deadlineMs });
    }
  } catch (cause) {
    log.warn('telemetry could not be flushed', { cause });
  } finally {
    clearTimeout(timer);
  }
}

async function register(endpoint: string, serviceName: string, log: Logger): Promise<Flush> {
  const [traceSdk, metricsSdk, resources, hooks, traceExporter, metricExporter] = await Promise.all(
    [
      import('@opentelemetry/sdk-trace'),
      import('@opentelemetry/sdk-metrics'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/context-async-hooks'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/exporter-metrics-otlp-http'),
    ],
  );
  const resource = resources.resourceFromAttributes({ 'service.name': serviceName });
  const tracerProvider = new traceSdk.TracerProvider({
    resource,
    spanProcessors: [
      new traceSdk.BatchSpanProcessor({
        exporter: new traceExporter.OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      }),
    ],
  });
  const meterProvider = new metricsSdk.MeterProvider({
    resource,
    readers: [
      new metricsSdk.PeriodicExportingMetricReader({
        exporter: new metricExporter.OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      }),
    ],
  });
  if (!trace.setGlobalTracerProvider(tracerProvider)) {
    await Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()]);
    log.warn(
      'the process already registered an OpenTelemetry provider; keelwerk exports nothing of its own',
    );
    return noFlush;
  }
  const contextManager = new hooks.AsyncLocalStorageContextManager();
  contextManager.enable();
  if (!context.setGlobalContextManager(contextManager)) {
    contextManager.disable();
    log.warn('the process already registered an OpenTelemetry context manager; keelwerk keeps it');
  }
  if (!metrics.setGlobalMeterProvider(meterProvider)) {
    await meterProvider.shutdown().catch(() => undefined);
    log.warn(
      'the process already registered an OpenTelemetry meter provider; keelwerk exports no metrics',
    );
    return (deadlineMs) => bounded(tracerProvider.forceFlush(), deadlineMs, log);
  }
  return (deadlineMs) =>
    bounded(
      Promise.all([tracerProvider.forceFlush(), meterProvider.forceFlush()]),
      deadlineMs,
      log,
    );
}

/**
 * Registers the OTLP exporter of `telemetry.otlp` once per process (S-141, open point 460).
 * Answers the flush the runtime awaits at the end of `stop`, bounded by `deadlineMs`; it never rejects.
 * The SDK modules are loaded only here, so a deployment without an endpoint never loads them.
 */
export async function registerTelemetry(input: {
  readonly telemetry: DeploymentDefinition['telemetry'];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: Logger;
}): Promise<Flush> {
  const named = endpointOf(input.telemetry?.otlp, input.env);
  if (named === undefined) {
    input.log.debug('no telemetry.otlp endpoint: OpenTelemetry data is not exported');
    return noFlush;
  }
  const endpoint = checkedUrl(named.endpoint, named.source);
  const held = kept();
  if (held !== undefined) {
    if (held.endpoint !== endpoint) {
      input.log.warn(
        'the process already exports telemetry to another endpoint; this one is ignored',
      );
    }
    await held.ready;
    return held.flush;
  }
  // Kept before the first await, so a second runtime starting at once finds it.
  const flushing: { flush: Flush } = { flush: noFlush };
  const ready = register(endpoint, input.env.OTEL_SERVICE_NAME ?? 'keelwerk', input.log).then(
    (flush) => {
      flushing.flush = flush;
    },
    (cause: unknown) => {
      input.log.warn('the OpenTelemetry exporter could not be registered', { cause });
    },
  );
  const registration: Registration = {
    endpoint,
    flush: (deadlineMs) => flushing.flush(deadlineMs),
    ready,
  };
  Reflect.set(globalThis, registrationKey, registration);
  await ready;
  return registration.flush;
}
