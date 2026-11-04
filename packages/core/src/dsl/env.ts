/** A value read from the process environment when the deployment boots. */
export interface EnvRef {
  readonly kind: 'env';
  readonly name: string;
}

/** `env('KEELWERK_DATA_URL')`: a deployment value, read from the environment at boot and nowhere else. */
export function env(name: string): EnvRef {
  return { kind: 'env', name };
}
