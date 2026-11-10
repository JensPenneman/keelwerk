import { idleColdStartMs } from './idle-cold-start-ms.ts';

/**
 * The probe's own limits end a stalled start earlier and the session rejects at once on "app
 * failed", so this limit only bounds a silent hang: 24 times the idle cold start, 120 s.
 */
export const startLimitMs: number = 24 * idleColdStartMs;
