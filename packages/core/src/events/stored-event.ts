import type { EventEnvelope } from './event-envelope.ts';

/** As stored: `data` and `before` encrypted and not upcast. The kernel decrypts and upcasts on read. */
export type StoredEvent = EventEnvelope<string, unknown>;
