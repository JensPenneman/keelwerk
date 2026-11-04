import type { RemoteConnection } from './remote-connection.ts';
import { version } from './version.ts';

/** The headers every request carries: version, client name, credential, selectors and device id. */
export function requestHeaders(state: RemoteConnection, body: boolean): Headers {
  const headers = new Headers({
    accept: 'application/json',
    'keelwerk-version': state.apiVersion,
    'keelwerk-client': `keelwerk-client/${version}`,
  });
  if (body) headers.set('content-type', 'application/json');
  if (state.token !== undefined) headers.set('authorization', `Bearer ${state.token}`);
  if (state.backend !== undefined) headers.set('x-keelwerk-backend', state.backend);
  if (state.tenant !== undefined) headers.set('x-keelwerk-tenant', state.tenant);
  if (state.deviceId !== undefined) headers.set('keelwerk-client-id', state.deviceId);
  return headers;
}
