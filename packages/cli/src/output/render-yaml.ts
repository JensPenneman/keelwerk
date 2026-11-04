import { stringify } from 'yaml';

/** A value as YAML (the `yaml` package). */
export function renderYaml(value: unknown): string {
  return stringify(value).trimEnd();
}
