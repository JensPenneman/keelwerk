/**
 * Settles on a later turn of the event loop than the one it was called in, so every promise
 * callback queued before the call, and every one those queue in turn, has run by then, however
 * slow the machine is; a chain that waits on input, output or a timer may still be pending. A
 * message on a channel is the turn: the test frameworks' fake timers replace `setImmediate` and
 * `setTimeout` and leave `MessageChannel` alone, however early in a test file they are installed.
 * Both ports are closed on delivery, so nothing is left that keeps the process alive.
 */
export function eventLoopTurn(): Promise<void> {
  return new Promise<void>((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      port2.close();
      resolve();
    };
    port2.postMessage(undefined);
  });
}
