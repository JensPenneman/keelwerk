import type { Meter, Telemetry } from '@keelwerk/core';
import type { RequestTelemetry } from './request-telemetry.ts';

/** The OpenTelemetry span kind `SERVER`, which the API package names as an enum. */
const serverSpanKind = 1;

/** Builds the span and metrics recorder of one host. */
export function createRequestTelemetry(
  telemetry: Telemetry,
  errorCounter: ReturnType<Meter['createCounter']>,
): RequestTelemetry {
  const duration = telemetry.meter.createHistogram('http.server.request.duration', {
    unit: 's',
    description: 'Duration of HTTP server requests.',
  });
  const active = telemetry.meter.createUpDownCounter('http.server.active_requests', {
    description: 'In-flight HTTP server requests.',
  });
  return {
    begin(request, state) {
      const url = new URL(request.url);
      const started = performance.now();
      const span = telemetry.tracer.startSpan(`${request.method} ${state.route}`, {
        kind: serverSpanKind,
        attributes: {
          'http.request.method': request.method,
          'server.address': url.hostname,
          'keelwerk.transport': 'http',
        },
      });
      active.add(1, { transport: 'http' });
      return (status) => {
        const { session, carrier } = state;
        const backend =
          session?.scope.level === 'deployment' ? undefined : session?.scope.backendId;
        const tenant = session?.scope.level === 'tenant' ? session.scope.tenantId : undefined;
        span.updateName(`${request.method} ${state.route}`);
        span.setAttributes({
          'http.route': state.route,
          'http.response.status_code': status,
          'keelwerk.transport': state.transport,
          ...(carrier?.connection !== undefined && {
            'client.address': carrier.connection.remote.address,
          }),
          ...(backend !== undefined && { 'keelwerk.backend': backend }),
          ...(tenant !== undefined && { 'keelwerk.tenant': tenant }),
          ...(state.action !== undefined && {
            'rpc.system': 'keelwerk',
            'rpc.method': state.action,
          }),
        });
        if (status >= 500) {
          span.setStatus({ code: 2 });
        }
        span.end();
        active.add(-1, { transport: 'http' });
        duration.record((performance.now() - started) / 1000, {
          method: request.method,
          route: state.route,
          status,
          transport: state.transport,
          ...(backend !== undefined && { backend }),
        });
        if (state.failure !== undefined) {
          errorCounter.add(1, {
            transport: state.transport,
            kind: state.failure.kind,
            code: state.failure.code,
          });
        }
      };
    },
  };
}
