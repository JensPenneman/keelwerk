/** A value read from the process environment when the deployment boots. */
export interface EnvRef {
  readonly kind: 'env';
  readonly name: string;
}

/** `env('KEELWERK_DATA_URL')`. */
export function env(name: string): EnvRef {
  return { kind: 'env', name };
}
