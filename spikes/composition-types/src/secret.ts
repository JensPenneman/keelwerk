/** A secret read from the deployment's secret provider. */
export interface SecretSource {
  readonly kind: 'secret';
  readonly name: string;
}

/** `secret('KEELWERK_MASTER_KEY')`. */
export function secret(name: string): SecretSource {
  return { kind: 'secret', name };
}
