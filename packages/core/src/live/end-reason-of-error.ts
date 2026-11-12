import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { CarrierEndReason } from './carrier-connection.ts';

/** `'version_retired'` for a KeelwerkError coded `core.api_version_retired`, else undefined: how a carrier ends a stream the floor passed (15.4.6). */
export function endReasonOfError(error: unknown): CarrierEndReason | undefined {
  return error instanceof KeelwerkError && error.code === 'core.api_version_retired'
    ? 'version_retired'
    : undefined;
}
