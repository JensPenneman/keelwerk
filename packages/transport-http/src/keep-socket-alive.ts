import type { LiveSocketState } from './live-socket-state.ts';

/** Starts the ping loop: a ping every `heartbeatMs`, and a socket that does not answer within the pong bound is terminated. */
export function keepSocketAlive(state: LiveSocketState): void {
  const { signal } = state.everything;
  const every = state.upgrade.host.liveSocket.heartbeatMs;
  void (async () => {
    while (await state.timers.sleepUntil(state.clock.now().add({ milliseconds: every }), signal)) {
      if (!(await state.open.connection.ping())) {
        state.open.terminate();
        return;
      }
    }
  })();
}
