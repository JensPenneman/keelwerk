/** `.gitignore`: what is built, installed or local. `generated/` stays, because it is committed (section 13.7). */
export function gitIgnore(): string {
  return `node_modules/
dist/
*.tsbuildinfo
.keelwerk/
.env
.env.*
!.env.example
`;
}
