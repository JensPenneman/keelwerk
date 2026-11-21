import type { KeelwerkError } from '@keelwerk/core';
import { errors } from '@keelwerk/core';

/**
 * A job names a group whose row does not exist. A group row is written before the group's first
 * job and never deleted, so the counts of the group's jobs would drift.
 */
export const groupRowMissing = (groupId: string): KeelwerkError =>
  errors.internal(`the job group ${groupId} has no row; the counts of its jobs would drift`);
