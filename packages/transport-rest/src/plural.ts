/**
 * The plural of the last word of a name (section 16.4.1): `s`, `x`, `z`, `ch` and `sh` take `es`, a
 * consonant followed by `y` becomes `ies`, every other word takes `s`.
 */
export function plural(name: string): string {
  if (/(?:[sxz]|ch|sh)$/.test(name)) {
    return `${name}es`;
  }
  if (/[^aeiou]y$/.test(name)) {
    return `${name.slice(0, -1)}ies`;
  }
  return `${name}s`;
}
