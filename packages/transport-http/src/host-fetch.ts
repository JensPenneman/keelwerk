import type { Dispatcher } from './dispatcher.ts';

/** `host.fetch(request)`: dispatches through the host's own routing, without a port (sections 16.8.5 and S-52). */
export function hostFetch(dispatcher: Dispatcher): (request: Request) => Promise<Response> {
  return (request) => dispatcher.handle(request, {});
}
