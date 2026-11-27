/** The name of a principal's request-rate bucket before it is hashed: `principalKey` is `user:<subject>` or `service:<id>`. */
export function principalRateBucketName(principalKey: string): string {
  return `core.principalRequestRate:${principalKey}`;
}
