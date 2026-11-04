export function scopeKey(schema: string | null | undefined, name: string): string {
  return `${schema ?? ''}.${name}`;
}
