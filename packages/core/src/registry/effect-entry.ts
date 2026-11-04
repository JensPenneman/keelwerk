import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
/** An external effect a module declares (section 7.9.5); the kernel records `requested` for it and an executor or an outside performer settles it. */
export interface EffectEntry {
  /** 'hooks.post': the module id and the key it is mounted under; also the `type` of the effect payload. */
  readonly ref: string;
  readonly module: string;
  readonly name: string;
  readonly performer: 'executor' | 'external';
  /** The reference of the executor that performs it; null when an outside performer does. */
  readonly executor: string | null;
  /** The versioned input shape (F-10 change note): personal fields are sealed in the record, secrets are references. */
  readonly input: StandardSchemaV1;
  /** The output shape; an effect without one has the empty shape. */
  readonly output: StandardSchemaV1;
}
