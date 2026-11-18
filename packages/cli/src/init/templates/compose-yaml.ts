/**
 * `.launchway/compose.yaml`, until the deployment platform is rebuilt (roadmap M4): one service
 * that runs the app from the deployment file. The database urls and the master key come from the
 * environment of the platform. The node image and the pnpm version are copies of
 * pins/node.Dockerfile and the root package.json of keelwerk, written by `pnpm pins`.
 */
export function composeYaml(): string {
  return `services:
  app:
    image: node:26.13.1-trixie
    working_dir: /app
    stop_grace_period: 70s
    volumes:
      - ..:/app
      - /app/node_modules
      - ledger:/var/lib/keelwerk/ledger
    environment:
      KEELWERK_HOST: 0.0.0.0
      KEELWERK_CONTROL_URL: \${KEELWERK_CONTROL_URL}
      KEELWERK_DATA_URL: \${KEELWERK_DATA_URL}
      KEELWERK_MASTER_KEY: \${KEELWERK_MASTER_KEY}
    ports:
      - "3000:3000"
    command: >
      sh -c "npm install -g pnpm@11.28.12 && pnpm install --frozen-lockfile &&
      pnpm exec tsc -b &&
      pnpm exec keelwerk start --config .launchway/deployment.ts"
volumes:
  ledger:
`;
}
