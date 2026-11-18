/**
 * The key of the idle extension timer of one session, as the session resolver sets it. The kernel
 * stores it as the id of the module and a digest of this text (`auth:<digest>`), so another module
 * that uses the same text reaches only its own timers and no text of a session id reaches the
 * store: requests of one session that come due while the job is pending replace it, and the newest
 * instant of a request stays.
 */
export function sessionExtensionKey(sessionId: string): string {
  return `extend:${sessionId}`;
}
