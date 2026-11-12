import type { HostBindings } from './host-bindings.ts';

/** The host's entry for every request, from the Node server and from `host.fetch`. */
export interface Dispatcher {
  handle(
    request: Request,
    extras: Pick<HostBindings, 'incoming' | 'operatorSocket' | 'upgrade' | 'remoteAddress'>,
  ): Promise<Response>;
}
