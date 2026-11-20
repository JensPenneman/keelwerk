import type { DecisionRequest } from './decision-request.ts';

/** The request of `principalRequestPlain`'s text; undefined when it was sealed for another command. */
export function principalRequestOf(
  plain: Uint8Array,
  commandId: string,
): DecisionRequest | undefined {
  const parsed = JSON.parse(new TextDecoder().decode(plain)) as {
    readonly command: string;
    readonly request: DecisionRequest;
  };
  return parsed.command === commandId ? parsed.request : undefined;
}
