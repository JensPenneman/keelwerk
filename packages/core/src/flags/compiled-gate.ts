/** A gate (20.6) as the kernel checks it. */
export interface CompiledGate {
  /** '<action ref>.gate' for the action's gate, '<module id>.gate' for the module's. */
  readonly rule: string;
  /** '<module id>.<flag>'. */
  readonly key: string;
  /** 'admit' when the flag's purpose is 'kill-switch', else 'authorize'. */
  readonly stage: 'admit' | 'authorize';
}
