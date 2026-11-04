import type { TransportAdapter } from '../../src/transport/transport-adapter.ts';

/** A transport adapter that projects nothing, for the stand-in transport modules. */
export function stubTransport(name: string): TransportAdapter {
  return {
    name,
    capabilities: { streaming: [], batching: false, binary: false },
    static: {},
    check: () => [],
    artifacts: () => [],
    mount: () => Promise.resolve({ close: () => Promise.resolve() }),
  };
}
