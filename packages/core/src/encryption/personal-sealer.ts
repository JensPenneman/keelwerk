import type { StoredEvent } from '../events/stored-event.ts';
import type { KweEnvelope } from '../keys/kwe-envelope.ts';
import type { StreamRecord } from '../storage/stream-record.ts';
import type {
  EncryptedPersonalValues,
  EncryptPersonalValuesInput,
} from './encrypt-personal-values.ts';
import type { OpenStreamRecordsInput } from './open-stream-records.ts';
import type { ProcessSubjectBinding } from './process-subject-binding.ts';
import type { SealProcessEventInput } from './seal-process-event.ts';
import type { SealStreamRecordsInput } from './seal-stream-records.ts';

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
  /** Records of a stream append with their personal members sealed under the keyed row's subject. */
  sealRecords(input: SealStreamRecordsInput): Promise<readonly unknown[]>;
  /** Stream records with their personal members opened; a member that does not open is left out. */
  openRecords(input: OpenStreamRecordsInput): Promise<readonly StreamRecord[]>;
  /** The payload of a process event with its personal members sealed under the instance's subject (S-124). */
  sealProcessEvent(input: SealProcessEventInput): Promise<Readonly<Record<string, unknown>>>;
  /** The instance key of a process sealed under its subject's data key for a job; `null` when the subject is erased. */
  sealProcessSubject(
    input: ProcessSubjectBinding & { readonly subject: string },
  ): Promise<KweEnvelope | null>;
  /** The subject a job sealed; `undefined` once the subject's keys are destroyed. */
  openProcessSubject(
    input: ProcessSubjectBinding & { readonly sealed: KweEnvelope },
  ): Promise<string | undefined>;
}
