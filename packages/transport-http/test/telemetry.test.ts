import { describe, expect, it } from 'vitest';
import { postJson } from './support/post-json.ts';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();

describe('telemetry (16.11)', () => {
  it('opens one server span per request with the route, status and action', async () => {
    const { host, telemetry } = setup();
    await host.fetch(postJson('/_keelwerk/v1/invoke', { action: 'library.echo' }));
    await host.fetch(new Request('https://library.example/_keelwerk/health'));
    expect(telemetry.spans).toHaveLength(2);
    expect(telemetry.spans[0]).toMatchObject({
      name: 'POST /_keelwerk/v1/invoke',
      ended: true,
      attributes: {
        'http.request.method': 'POST',
        'http.route': '/_keelwerk/v1/invoke',
        'http.response.status_code': 200,
        'rpc.system': 'keelwerk',
        'rpc.method': 'library.echo',
        'keelwerk.backend': 'b1',
        'keelwerk.tenant': 't1',
      },
    });
    expect(telemetry.spans[1]?.attributes['http.route']).toBe('/_keelwerk/health');
  });

  it('records duration, active requests and errors', async () => {
    const { host, telemetry } = setup();
    await host.fetch(postJson('/_keelwerk/v1/invoke', { action: 'library.echo' }));
    await host.fetch(postJson('/_keelwerk/v1/invoke', '{'));
    const names = telemetry.measurements.map((m) => m.name);
    expect(names.filter((n) => n === 'http.server.request.duration')).toHaveLength(2);
    expect(names.filter((n) => n === 'http.server.active_requests').map((_, i) => i)).toHaveLength(
      4,
    );
    const errors = telemetry.measurements.filter((m) => m.name === 'keelwerk.transport.errors');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.attributes).toMatchObject({
      kind: 'validation',
      code: 'core.malformed_request',
    });
  });
});
