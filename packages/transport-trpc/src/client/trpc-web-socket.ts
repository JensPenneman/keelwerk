import { trpcSubprotocol } from '../socket/trpc-subprotocol.ts';

type Offer = ConstructorParameters<typeof WebSocket>[1];

/** The protocols a caller named, as a list: a string, a list, or the `protocols` of Node's `WebSocketInit`. */
function namedBy(offer: Offer): readonly string[] {
  if (offer === undefined) return [];
  if (typeof offer === 'string') return [offer];
  if (Array.isArray(offer)) return offer;
  const protocols: unknown = Reflect.get(offer, 'protocols');
  if (typeof protocols === 'string') return [protocols];
  return Array.isArray(protocols) ? protocols : [];
}

/** The offer with `keelwerk.trpc.v1` among its protocols, once, and every other member of a `WebSocketInit` kept. */
function offerWith(offer: Offer): Offer {
  const named = namedBy(offer);
  const protocols = named.includes(trpcSubprotocol) ? [...named] : [...named, trpcSubprotocol];
  if (typeof offer === 'object' && offer !== null && !Array.isArray(offer)) {
    return { ...offer, protocols };
  }
  return protocols;
}

/**
 * A web socket class for `createWSClient({ WebSocket })` (section 16.7.5): `base`, offering the
 * subprotocol `keelwerk.trpc.v1` beside the protocols the caller names, never twice. tRPC's client
 * constructs its socket with the URL alone, so without this the upgrade names no subprotocol and the
 * host refuses it.
 */
export function trpcWebSocket(base: typeof WebSocket): typeof WebSocket {
  return class TrpcWebSocket extends base {
    constructor(url: string | URL, offer?: Offer) {
      super(url, offerWith(offer));
    }
  };
}
