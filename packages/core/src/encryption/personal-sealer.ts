import type { StoredEvent } from '../events/stored-event.ts';
import type {
  EncryptedPersonalValues,
  EncryptPersonalValuesInput,
} from './encrypt-personal-values.ts';

/**
 * What a sealing unit adds to a unit besides its row store: sealing the personal values of an
 * event the write path is about to hash, and opening the events it reads back (14.7.4).
 */
export interface PersonalSealer {
  sealEvent(input: EncryptPersonalValuesInput): Promise<EncryptedPersonalValues>;
  /** Events with their personal values opened; a value that stays sealed keeps its envelope (a replay compares it so). */
  openEvents(events: readonly StoredEvent[]): Promise<readonly StoredEvent[]>;
  /** Events as a client or handler reads them: a value that stays sealed is absent (14.7.9.8). */
  readEvents(events: readonly StoredEvent[]): Promise<readonly StoredEvent[]>;
}
