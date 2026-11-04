/**
 * A named composition check (decision 31a): `unknown` when there is no problem, otherwise a
 * required property whose literal type names the problem, so the call reads
 * "Property 'missingModules' is missing ... required in type { missingModules: 'accounts' }".
 */
export type Check<Problem, Key extends string> = [Problem] extends [never]
  ? unknown
  : { readonly [K in Key]: Problem };
