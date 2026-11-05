import { usageFailure } from '../../context/usage-failure.ts';
import type { ProducerName } from '../../producers/producer-name.ts';
import { producerNames } from '../../producers/producer-name.ts';

/** The producers `--only` names (repeated or comma separated); an unknown name is a usage mistake. */
export function generateOnly(
  given: readonly string[] | undefined,
): readonly ProducerName[] | undefined {
  if (given === undefined || given.length === 0) return undefined;
  const names = given.flatMap((item) => item.split(',')).map((item) => item.trim());
  return names.map((name) => {
    const known = producerNames.find((candidate) => candidate === name);
    if (known === undefined) {
      throw usageFailure(
        `Unknown producer "${name}". The producers are ${producerNames.join(', ')}.`,
      );
    }
    return known;
  });
}
