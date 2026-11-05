/** `.launchway/launchway.ts`: what only the deployment platform reads (section 17.3.1). */
export function launchwayTs(): string {
  return `/** Domains and routes, previews, environment and node: read by the deployment platform, not by keelwerk. */
export const launchway: {
  readonly domains: readonly string[];
  readonly previews: boolean;
  readonly environment: Readonly<Record<string, string>>;
  readonly node: string | undefined;
} = {
  domains: [],
  previews: false,
  environment: {},
  node: undefined,
};
`;
}
