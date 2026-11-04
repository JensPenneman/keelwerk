import type { HostContext } from './host-context.ts';
import { jsonResponse } from './json-response.ts';

/** `GET /_keelwerk/ready`: the control store, the placements and the queue answer (section 16.3.3). */
export async function readyResponse(host: HostContext): Promise<Response> {
  let ready = false;
  try {
    ready = (await host.deps.ready?.()) ?? true;
  } catch {
    ready = false;
  }
  return jsonResponse(ready ? 200 : 503, { status: ready ? 'ready' : 'unavailable' });
}
