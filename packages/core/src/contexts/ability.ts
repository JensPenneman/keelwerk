/** Pure questions over the rules: may the principal do this? */
export interface Ability {
  can(action: string): boolean;
}
