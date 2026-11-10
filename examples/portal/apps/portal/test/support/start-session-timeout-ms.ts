import { startLimitMs } from './start-limit-ms.ts';
import { stopLimitMs } from './stop-limit-ms.ts';

/** The hook that starts a session must outlast the start, the stop of a failed start, and a margin; with less, the runner's own timeout would hide the reason. */
export const startSessionTimeoutMs: number = startLimitMs + stopLimitMs + 30_000;
