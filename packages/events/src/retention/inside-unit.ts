import type { RetentionRunRule, Scope } from '@keelwerk/core';

/** A test seam of the retention worker: runs inside every writing unit before its purge; a throw fails that unit. */
export type InsideUnit = (scope: Scope, buffer: RetentionRunRule['kind']) => Promise<void>;
