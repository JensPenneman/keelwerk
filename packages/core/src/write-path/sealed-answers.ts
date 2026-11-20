import type { RecordedAnswer } from '../events/recorded-answer.ts';
import { sealedValueText } from '../keys/sealed-value-text.ts';
import type { Unit } from '../storage/unit.ts';

/**
 * The answers a decision records, with every issued verifier sealed, never plain: the row's own
 * sealed text, or a value of its own under the decision when no row took it (7.9.3, 14.7.4).
 */
export async function sealedAnswers(
  unit: Unit,
  commandId: string,
  answers: readonly RecordedAnswer[],
  sealedVerifiers: ReadonlyMap<string, string>,
): Promise<readonly RecordedAnswer[]> {
  const sealed: RecordedAnswer[] = [];
  for (const answer of answers) {
    if (answer.kind !== 'secret') {
      sealed.push(answer);
      continue;
    }
    const text =
      sealedVerifiers.get(answer.verifier) ??
      sealedValueText(
        await unit.keys.sealValue(
          { entity: 'core.decision', id: commandId, field: `verifier.${answer.publicId}` },
          new TextEncoder().encode(answer.verifier),
        ),
      );
    sealed.push({ ...answer, verifier: text });
  }
  return sealed;
}
