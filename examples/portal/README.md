# Portal

Accounts and sign-in on keelwerk: the `accounts` and `auth` modules behind the REST transport,
as an app in the canonical layout.

```
.launchway/deployment.ts   the deployment: PostgreSQL addressed by the environment
.launchway/launchway.ts    what the deployment platform reads
.launchway/compose.yaml    one service that runs the app, with a named volume for the ledger
apps/portal/               the app (`@keelwerk-examples/app-portal`) and its generated files
```

## From a fresh clone

Node 26 or later and pnpm 11 are needed. Nothing is built.

```sh
git clone https://github.com/JensPenneman/keelwerk.git
cd keelwerk
pnpm install --frozen-lockfile
cd examples/portal
PORT=0 node --conditions=@keelwerk/source ../../packages/cli/src/bin/keelwerk.ts dev --no-types
```

`keelwerk dev` runs the app on PGlite below `.keelwerk/` of this directory and prints its
loopback address. In a second terminal, in the same directory, with `keelwerk` standing for the
command above and `$URL` for the printed address (for example `http://127.0.0.1:41233`); the
commands find the running app's operator socket by themselves:

```sh
keelwerk backend create portal --app portal --placement default \
  --settings '{"accounts":{"allowSelfRegistration":true},"auth":{"addressAttemptsPerMinute":1000},"rest":{"docs":false,"cors":[]}}'
keelwerk tenant create acme --backend portal --domain 127.0.0.1
curl -X POST "$URL/api/auth/sign-up" -H 'content-type: application/json' \
  -d '{"identifier":"ada@example.org","password":"a long password","displayName":"ada"}'
```

The tenant resolves by the `x-keelwerk-tenant` header or by host name; this request carries no header, so the loopback address is its domain. Point a profile at the
app (`~/.config/keelwerk/profiles.json`, with the printed address written out: `{"current":"portal","profiles":{"portal":{"url":"$URL"}}}`;
plain `http://` is accepted for loopback hosts only), then:

```sh
keelwerk login --input '{"identifier":"ada@example.org"}'   # asks for the password without echo
keelwerk call auth.whoami
```

`node scripts/check-fresh-clone.ts` at the repository root does all of this in a temporary clone
and reports each step.

## In production

`keelwerk start --config .launchway/deployment.ts` reads `KEELWERK_CONTROL_URL`,
`KEELWERK_DATA_URL` and `KEELWERK_MASTER_KEY` from the environment. `.launchway/compose.yaml`
runs it in a container; the ledger lives on the `ledger` volume and the service gets 70 seconds
to stop.
