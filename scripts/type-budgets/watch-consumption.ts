/**
 * What `consume.ts` reads of the generated `watch` of the last module's entity: its kind, its input
 * (`WatchInput` over the readable row's filter, given `ids` and a `filter`) and its events (`EntityChange` of the readable row, the row itself included), so the
 * per-entity types are instantiated and not only the member's name.
 */
export function watchConsumption(last: string): string {
  const watch = `AppActionTree<SyntheticApp>['m${last}']['entities']['a']['watch']`;
  return [
    `export const lastWatch: ${watch}['kind'] = 'subscription';`,
    `export const lastWatchInput: ${watch}['input'] = { from: 'beginning', ids: ['x'], filter: { name: 'x' } };`,
    `export const lastWatchEvent: ${watch}['events']['type'] = 'removed';`,
    `export const lastWatchRow: keyof Extract<${watch}['events'], { type: 'changed' }>['row'] = 'id';`,
    '',
  ].join('\n');
}
