/** Where a contract is provided: by a selected module, or by an infrastructure entry. */
export type ContractLevel = 'app' | 'deployment';

/** A capability with several implementations (section 5.2). */
export interface Contract<C extends string = string, L extends ContractLevel = ContractLevel> {
  readonly kind: 'contract';
  readonly contract: C;
  readonly level: L;
}

/** Any contract. */
export type AnyContract = Contract;

/**
 * Declares a contract. The interface type of section 5.2 (`defineContract<LiveQueries>(...)`) is
 * not a parameter: an explicit type argument would stop the inference of the literal name.
 */
export function defineContract<const C extends string, const L extends ContractLevel>(
  contract: C,
  level: L,
): Contract<C, L> {
  return { kind: 'contract', contract, level };
}
