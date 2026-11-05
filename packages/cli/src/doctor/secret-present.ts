import type { SecretRef } from '@keelwerk/core';

interface Provider {
  resolve(ref: SecretRef): Promise<string | undefined>;
}

function isProvider(value: unknown): value is Provider {
  return (
    typeof value === 'object' &&
    value !== null &&
    'resolve' in value &&
    typeof value.resolve === 'function'
  );
}

/** Whether a secret reference resolves, through the deployment's secret providers and then the environment (the order `startRuntime` uses). */
export async function secretPresent(
  ref: SecretRef,
  infrastructure: readonly unknown[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<boolean> {
  for (const entry of infrastructure) {
    if (isProvider(entry) && (await entry.resolve(ref)) !== undefined) return true;
  }
  return env[ref.ref] !== undefined;
}
