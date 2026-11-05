/** `pnpm-workspace.yaml`: the packages of the layout (section 23.1) and exact versions. */
export function workspaceYaml(): string {
  return `packages:
  - apps/*
  - modules/*

saveExact: true
engineStrict: true
`;
}
