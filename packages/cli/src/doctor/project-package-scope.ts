/** The workspace directories the project checks cover: libraries, apps, modules and examples, not spikes or tooling. */
export function inProjectScope(dir: string): boolean {
  return /^(packages|examples|apps|modules)(\/|$)/.test(dir);
}
