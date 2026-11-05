/** Thrown by the answerer of an inline effect during a dry run that has no recorded outcome for it. */
export class DryRunStop extends Error {
  readonly effect: string;
  readonly effectInput: unknown;

  constructor(effect: string, effectInput: unknown) {
    super(`a dry run stops here: "${effect}" would perform`);
    this.name = 'DryRunStop';
    this.effect = effect;
    this.effectInput = effectInput;
  }
}
