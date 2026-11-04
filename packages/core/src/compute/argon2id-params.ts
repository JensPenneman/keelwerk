/** The Argon2id parameters of a hash: OWASP's current minimum is 19 MiB, two passes, one lane (17.2.2). */
export interface Argon2idParams {
  readonly memoryKib: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly tagLength: number;
}

/** The parameters new hashes use. */
export const argon2idParams: Argon2idParams = Object.freeze({
  memoryKib: 19_456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
});
