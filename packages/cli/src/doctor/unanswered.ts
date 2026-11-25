/** What a read of the control store ends with when its deadline has passed. */
export function unanswered(): never {
  throw new Error('no answer within the bound that doctor sets for a read of the control store');
}
