/** The note for contract and rebuild steps that stay deferred, with the command that applies them. */
export function deferredNote(deferred: readonly string[]): string {
  return `deferred: ${deferred.join('; ')} (run keelwerk db apply --contract --config .keelwerk/dev-deployment.ts)`;
}
