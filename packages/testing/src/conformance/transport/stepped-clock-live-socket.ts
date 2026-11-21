/**
 * The host's live socket bounds for a runner whose cases move a pinned clock in steps of a minute or
 * more: the session check and the heartbeat sit beyond the longest loop of steps any case makes
 * (`expectSteppedClockBounds`), so the host sends no ping whose pong deadline a later step could pass
 * and no periodic session check closes a socket a case waits on. With the default heartbeat the ping
 * goes out at 30 s of the clock and the next step passes its pong deadline before the pong, a real
 * network round trip, has come back: the socket ends 1006.
 */
export const steppedClockLiveSocket = {
  revalidateMs: 100_000_000,
  heartbeatMs: 100_000_000,
} as const;
