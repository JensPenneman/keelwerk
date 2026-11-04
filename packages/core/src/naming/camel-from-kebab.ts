/** `api-keys` becomes `apiKeys`: a kebab module id as a lower camel identifier. */
export function camelFromKebab(name: string): string {
  return name
    .split('-')
    .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
}
