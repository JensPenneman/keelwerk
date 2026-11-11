import { errors } from '../errors/errors.ts';

/**
 * A rule of a deployment-wide row (no backend) may not list principals: a principal id is the bare
 * subject of one backend's identity source, so the same id would also match another backend's
 * different principal wherever that backend has no row of its own (20.10). Throws `validation`
 * naming the rule's `principals` path.
 */
export function checkDeploymentRules(targeting: {
  readonly rules: readonly { readonly principals?: readonly string[] | undefined }[];
}): void {
  for (const [index, rule] of targeting.rules.entries()) {
    if (rule.principals !== undefined) {
      throw errors.validation(
        `rules[${index}].principals: a rule of a deployment-wide row cannot list principals; a principal id belongs to one backend's identity source. Write a row for the backend.`,
      );
    }
  }
}
