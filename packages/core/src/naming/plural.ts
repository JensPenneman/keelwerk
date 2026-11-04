/**
 * The plural of the last word of a name, frozen as part of the naming contract (section 16.4.1):
 * `s`, `x`, `z`, `ch` and `sh` take `es`; a consonant and `y` become `ies`; everything else takes `s`.
 */
export function plural(name: string): string {
  if (/(?:[sxz]|ch|sh)$/i.test(name)) {
    return `${name}es`;
  }
  if (/[b-df-hj-np-tv-xz]y$/i.test(name)) {
    return `${name.slice(0, -1)}ies`;
  }
  return `${name}s`;
}
