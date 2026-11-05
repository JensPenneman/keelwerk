/** Pure questions over the rules: may the principal do this? */
export interface Ability {
  can(action: string): boolean;
  /**
   * Whether the principal may filter or sort the entity query `action` by `field`: the field is
   * revealed for every row its read plan selects (section 8.4).
   */
  canFilterBy(action: string, field: string): boolean;
}
