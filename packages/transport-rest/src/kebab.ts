/** Lower camel case to kebab case on word boundaries: `resetPassword` becomes `reset-password` (section 16.4.1). */
export function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
