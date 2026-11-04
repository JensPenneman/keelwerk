/** An external effect a module declares (section 7.9.5); the kernel records `requested` for it and an executor or an outside performer settles it. */
export interface EffectEntry {
  /** 'hooks.post': the module id and the key it is mounted under; also the `type` of the effect payload. */
  readonly ref: string;
  readonly module: string;
  readonly name: string;
  readonly performer: 'executor' | 'external';
  /** The reference of the executor that performs it; null when an outside performer does. */
  readonly executor: string | null;
}
