import { jsonResponse } from './json-response.ts';

/** `GET /_keelwerk/health`: the process runs. Deployment-level and unauthenticated. */
export function healthRoutes(): Response {
  return jsonResponse(200, { status: 'ok' });
}
