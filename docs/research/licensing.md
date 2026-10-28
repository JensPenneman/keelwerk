> Note (2026-10-28): the project was renamed from pennestack to **keelwerk** on 2026-10-28; this
> research note keeps the old name as written at the time.

# Licensing and ownership: research for decision 20

Date: 2026-10-26. Status: research input for decision 20 (the licence, `docs/decisions.md`), due
before the repository becomes public; it decides nothing by itself. Scope: the licence families,
what Belgian and EU law protects, ownership and contributions for a solo author, and three ranked
paths for Jens's goal ("my idea never stolen, always the one making the
profit"). Method: the brief, the README and architecture section 22; primary texts (licences, GitHub's
and npm's terms, EU directives, Belgian law, EPO guidelines) and the companies' own announcements;
15 of the 16 web searches and all 12 page fetches the brief allowed. "(not re-checked)" marks prior knowledge not verified within the caps.

One line before everything else: no licence stops anyone from re-implementing the idea. Copyright
protects the code and the documents as written, a trademark protects the name, a licence binds only
people who copy the code, and the only complete protection is not publishing.

## 1. Comparison

| Licence (SPDX id) | Others may | Others may not | Who keeps the profit | Adoption effect for a framework | Examples |
|---|---|---|---|---|---|
| MIT, BSD-2/3-Clause | use, change, sell, close, host; keep the notice | nothing else is restricted | anyone; Jens earns only from what he sells around it | maximal; the norm for code people embed | NestJS, Fastify, Hono, tRPC, Express |
| Apache-2.0 | the same, plus a patent licence from every contributor | use the licensor's trademarks (§6); sue over patents in the work without losing the patent licence | anyone | maximal; companies prefer it for the patent clause | Prisma, Drizzle, Supabase |
| MPL-2.0, LGPL-3.0 (weak copyleft) | embed in closed products, host, sell | close the licensed files (MPL) or the library (LGPL) when distributing them | anyone running a service; a backend is never distributed, so the duty rarely triggers | good; some friction with LGPL for bundled JavaScript | Terraform until 1.5 and OpenTofu (MPL), Qt (LGPL + commercial) |
| GPL-3.0 | use internally; host a service without sharing anything | distribute a product containing it without GPL-ing the product | SaaS competitors keep theirs; only distributors are bound | very low for an embedded framework; Sencha's Ext JS is the cautionary tale (not re-checked) | MySQL (GPL-2.0 + commercial), Ext JS |
| AGPL-3.0 (+ commercial licence) | use internally; run anything whose users are only staff | offer a product built on it over a network without offering its source to those users (§13), unless they buy the commercial licence | Jens, from everyone who sells a network product on it and will not open it | low: many corporate policies ban AGPL outright (not re-checked); a CLA is needed to sell the second licence | Grafana (2021), Elastic (2024-08), Redis 8 (2025-05), Unleash (2026-06) |
| BUSL-1.1 (MariaDB); parameters: Additional Use Grant, Change Date at most four years per version, Change License (GPL-compatible) | read, change, non-production use; production use as far as the grant allows | the uses the grant excludes (typically offering the work as a hosted or embedded service competing with the licensor's products) until the Change Date | Jens for up to four years per version, then anyone | medium-low: not open source by the OSI definition; the CNCF, the ASF and some allow-lists refuse it; adopted software that switches to it gets forked | Terraform (2023-08, now IBM), Akka (2022-09, free under US$25M revenue), Directus (2023, free under US$5M, own licence since 2025-05) |
| FSL-1.1-ALv2 or FSL-1.1-MIT (Sentry) | everything except a Competing Use: internal use, production, building and selling products on it | make it available "in a commercial product or service" that substitutes for it or for the licensor's existing products built on it, or "offers the same or substantially similar functionality", for two years per version | Jens for two years per version, then Apache-2.0 or MIT | medium: the same refusals as BUSL, but fixed terms and a narrower, clearer non-compete | Sentry (2023-11), Codecov, Convex backend (2024), Liquibase 5 (2025-09) |
| Elastic-2.0 | use, change, redistribute, host for own use | provide it to third parties as a hosted or managed service; break licence keys; remove notices; no change date | Jens, indefinitely | low-medium; written for servers, not libraries | Elasticsearch, Kibana (2021; AGPL-3.0 added 2024-08-29) |
| SSPL-1.0 (MongoDB) | as AGPL | offer it as a service without releasing the source of the whole service stack (§13) | Jens | low; never OSI-approved; wider and vaguer than AGPL | MongoDB (2018-10), Redis 7.4 (2024-03), Elastic (2021) |
| Commons Clause (rider on MIT or Apache, 2018) | use, change | "Sell" the software, including hosting whose value derives from it | Jens | low; a non-standard rider Redis itself abandoned | Redis modules (2018) |
| PolyForm 1.0.0 (2019): Noncommercial, Internal Use, Small Business (under 100 people and US$1M revenue, 2019 dollars), Shield (no competing product or service), Strict (no commercial use, changes or sharing) | the named purpose only | everything else | Jens | low; precise but rarely used; Small Business and Shield fit a framework | few |
| Sustainable Use License (n8n, 2022, "fair-code") | use and change for internal business, personal or non-commercial purposes; share free of charge | sell it, host it for others or build a paid product on it without an enterprise licence | n8n, fully | low outside end-user tools; works because n8n is an application, not a library | n8n |
| Prosperity 3.0.0, Parity 7.0.0 (Kyle Mitchell) | Prosperity: non-commercial use and a 30-day commercial trial; Parity: anything, if every program built with it is released as open source | Prosperity: commercial use after the trial; Parity: keep a product closed | Jens (both are sold next to a private licence) | very low for a framework | licensezero projects |
| No licence, public repository ("all rights reserved") | view and fork on GitHub (Terms D.5: "use, display, perform and reproduce (by forking) Your Content" through GitHub); GitHub may process it "including by training AI Features" (D.4) | use it in their own software, change it, redistribute it | Jens | zero: nobody can lawfully build on it, and the ideas still leak | — |
| Private repository | invited collaborators read | anything without a written licence; trade secrets stay secrets | Jens | none by definition | pennestack today |

## 2. The record, 2018–2026

- MongoDB → SSPL, 2018-10; never reversed (not re-checked).
- Sentry: BSD → BUSL 2019-11 → FSL 1.0 on 2023-11-17 (two years, then Apache-2.0 or MIT), revised as
  1.1; launched Fair Source (fair.io, 2024: FSL, Fair Core License, BUSL).
- Elastic: Apache-2.0 → SSPL/ELv2 in 2021-01 after the AWS conflict; AWS forked OpenSearch;
  2024-08-29 Elastic added AGPL-3.0 because "enough time would pass" (Shay Banon).
- Akka: Apache-2.0 → BUSL-1.1 on 2022-09-07 (free under US$25M revenue, Apache-2.0 after three
  years); the Apache Pekko fork took the community.
- HashiCorp: MPL-2.0 → BUSL-1.1 on 2023-08-10 (production use allowed unless competitive with
  its products; MPL-2.0 after four years). OpenTofu forked (Linux Foundation 2023-09, GA
  2024-01, CNCF sandbox 2025-04-23); IBM closed the acquisition on 2025-02-27 and kept the BUSL;
  OpenTofu now runs at Fidelity, Capital One and Boeing (2026 vendor write-ups).
- Redis: BSD → RSALv2/SSPL on 2024-03-20; the Linux Foundation launched Valkey on 2024-03-28 (AWS,
  Google, Oracle); Redis added AGPL-3.0 with Redis 8 on 2025-05-01, saying the forks had levelled the
  field; Valkey keeps shipping.
- Liquibase: Apache-2.0 → FSL-1.1-ALv2 with 5.0 on 2025-09-30, plus a CLA; Keycloak (CNCF) must
  replace it: the CNCF forbids source-available dependencies (2025-10 to 2026-08).
- NATS: 2025-04 Synadia announced it would take the server to BUSL and out of the CNCF; the CNCF
  asserted the trademark; settled 2025-05-01: NATS stays Apache-2.0, Synadia transferred the marks
  and may fork only under a new name.
- 2026: Unleash core → AGPL-3.0 (2026-06); GitHub's terms now license public content for AI
  training (effective 2026-04-27).

Lessons: permissive → strict after adoption produces a fork that keeps the users (OpenTofu, Valkey,
Pekko, OpenSearch), and only holders of a CLA could switch at all; strict → open is cheap and often
follows (Elastic, Redis); the name is the asset (NATS); source-available is tolerated for products
and backends (Sentry, Terraform, Convex, Directus) and bites when the code is a dependency of other
projects (Liquibase); AGPL is enforced by legal departments, not courts, so a framework under AGPL
loses the companies that would pay.

## 3. What the law protects (Belgium and the EU)

Copyright arises on creation, without registration (Berne; Code of Economic Law, WER, XI.165). Software is protected as a
literary work "including preparatory design material" (Directive 2009/24/EC art. 1(1); WER XI.294 to
XI.304): the source, the compiled output and `docs/architecture.md` are covered, for 70 years after
the author's death (XI.166). Not covered: "ideas and principles which underlie any element of a
computer program, including those which underlie its interfaces" (art. 1(2)); the CJEU added
functionality, programming languages and file formats (C-406/10 SAS v World Programming,
2012-05-02). A lawful user may observe, study and test to learn the ideas (art. 5(3)) and decompile
for interoperability (art. 6), whatever the licence says. So a clean-room re-implementation of
pennestack's model (modules, entities, actions, authorization, derived transports, ledger,
multi-tenancy) is lawful; copying the text of the architecture or the code is not.

Moral rights on software are the Berne art. 6bis minimum (WER XI.297): attribution and objection to
distortions harmful to honour or reputation. They stay with Jens after any assignment; no commercial
lever.

Patents: the EPC excludes "programs for computers ... as such" (art. 52(2)(c) and (3)); a program is
patentable only through a "further technical effect" beyond the normal hardware-software interaction
(T 1173/97; EPO Guidelines G-II 3.6), and only technical features count for inventive step (COMVIK,
T 641/00). Framework design is ordinary programming and would not pass; a filing costs thousands of euros
and publishes the idea after 18 months; Belgium (WER XI.4) has the same exclusion. Publishing buys one thing: it is prior
art, so nobody can patent pennestack's ideas against Jens.

Trade secrets: Directive (EU) 2016/943, transposed by the law of 30 July 2018 (WER I.17/1 and
XI.332/1 ff.), protect information while it is secret, valuable because secret and kept under
reasonable measures. Everything in a public repository stops being a trade secret the day it goes
public, and the architecture document (130,000 words) gives the idea away more completely than the
code will for a long time. This is the only right that covers the idea; sharing with chosen people
under an NDA preserves it.

Trademarks are the one right that stops a competitor from calling their thing "pennestack". Benelux
(BOIP): €244 for one class, €27 for the second, €81 for each further class, ten years, renewable
(€263 for one class). EU (EUIPO): €850, €50, €150, ten years. Classes: 9 (software), 42 (software and platform as a service, development), 38 only if
mail service is sold to others; two Benelux classes cost €271, three €352.
"pennestack" is a coined word without a descriptive meaning for software, so it is distinctive in
principle; the web shows no company or mark of that name (nearest: Pinestack GmbH, a German
SaaS); search the BOIP and EUIPO registers (TMview) before filing.
pennestack.com, .be and .io were unregistered on 2026-10-26 (.dev unverified). The name is a working
name: register once it is final, or now and let it lapse (revocable after five years without use).
BOIP's i-DEPOT gives dated proof of what existed when.

Database right (Directive 96/9/EC; WER XI.305 ff.): fifteen years for a database built with a
substantial investment; it covers data, not code.

What limits a competitor in practice: time (re-implementing a system of this size), the trademark,
the users and adapters around the original, the quality and cadence of the code, and, under a
source-available licence and only during its protected period, the ban on selling the code itself.

## 4. Ownership, company, contributors

- Jens is the author and sole rights-holder of every line he writes; keep it provable (signed
  commits, i-DEPOT).
- Personal versus company: the rights stay with the natural person until a written assignment, which
  in Belgium must state each mode of exploitation, its scope, duration and remuneration and is read
  restrictively (WER XI.167); the employer presumption for
  software (XI.296) covers employees only, not the director of his own company. A company would hold the
  economic rights, sign licences and CLAs and invoice commercial licences. Whom to ask: a Belgian IP lawyer for the assignment and the CLA text; an accountant
  for the tax side.
- Contributions: a DCO (developercertificate.org; Linux, OpenTofu, Valkey) is a sign-off in which the
  contributor certifies the right to submit under the project's licence and keeps the copyright.
  Every contributed line then has another owner, and later re-licensing or dual licensing needs that
  person's consent (OpenTofu and Valkey cannot be relicensed by one party; HashiCorp, Redis, Elastic
  and Liquibase required a CLA). A CLA in the Apache ICLA form grants a perpetual, irrevocable
  licence including the right to sublicense, which is enough for dual licensing. For pennestack: no code contributions
  for now (said in `CONTRIBUTING.md`), or a CLA with an explicit right to relicense (cla-assistant
  automates it).
- What re-licensing can and cannot undo: strict → permissive is always possible for his own code, and
  FSL and BUSL do it automatically per version; permissive → strict works only for new versions and
  only with the rights to every line, while versions already published under MIT or Apache stay
  available forever, which is what the forks lived on. Nothing published can be recalled: GitHub's
  terms let everyone keep their forks and npm's say users "may continue to copy and share Your
  Content after termination".
- npm leaves the licence to the author and does not police it (Open-Source Terms, 2022-03-10).
  Practical: `LICENSE.md` in every published package, a valid SPDX id in the `license` field
  (`FSL-1.1-ALv2`, `BUSL-1.1`, `AGPL-3.0-only`, `Apache-2.0`; `SEE LICENSE IN LICENSE.md` for custom
  text; `FSL-1.1-Apache-2.0` is not an SPDX id), one licence for every `@pennestack` package, and the
  npm organisation `pennestack` created now to hold the scope (no `@pennestack` package exists; the
  name itself could not be checked anonymously).

## 5. The adoption trade-off for a framework

A framework is embedded: whatever its licence says about derivative works or network use reaches
the user's product. That is why nearly every framework people embed is MIT or Apache-2.0 and why
copyleft frameworks are rare and dual-licensed (Qt, Ext JS). Source-available non-compete licences do not reach the user's product, so
a framework can carry them (Convex, Directus), but foundations and allow-list companies refuse them
(Liquibase). Open core (permissive
core, paid or source-available modules and hosting) is the usual compromise and maps onto pennestack:
core, data and transports permissive; the two platforms and later enterprise modules protected. Staying private, or source-available to
chosen people under an NDA, is the only option that protects the idea; it costs every outside user,
and the brief's "public repository" constraint is itself a decision to give the ideas away.

## 6. Three paths, ranked for the goal

Shared steps, in order: keep the repository private until the M1 slice runs (publication is
irreversible under every option); after a TMview check, file the Benelux mark in classes 9 and 42
(€271) once the name is final, and claim the npm organisation and the domains; file an i-DEPOT;
publish the architecture document only when the code exists; decide on contributions; give the
platforms their own licence.

### Path 1: source-available with delayed opening (first for the goal)

- Licence: Functional Source License, Version 1.1, ALv2 Future License (SPDX `FSL-1.1-ALv2`), on every
  `@pennestack` package and on both platforms; Licensor: Jens Penneman; each version becomes
  Apache-2.0 two years after its release.
- Stricter dial if two years is too short: Business Source License 1.1 with Licensor "Jens
  Penneman", Licensed Work "pennestack <version>", Additional Use Grant "You may make production use
  of the Licensed Work, provided such use does not include offering the Licensed Work to third
  parties on a hosted or embedded basis which is competitive with the Licensor's products"
  (HashiCorp's wording), Change Date "four years from the first public release of each version",
  Change License "MPL-2.0" (the proven GPL-compatible choice; Apache-2.0 only if the lawyer confirms).
- Trademark: Benelux classes 9 and 42; EU later if a market appears.
- Contributors: none, or a CLA with the right to relicense; a DCO does not suffice.
- npm: `"license": "FSL-1.1-ALv2"`, `LICENSE.md` in every tarball, a Fair Source note in the README.
- What it does: nobody may sell pennestack itself (hosted, managed, or as a substitute built from
  its code) while a version is younger than two (or four) years; everybody may build and sell their
  own products on it; only Jens can grant exceptions and sell commercial licences; moving to
  Apache-2.0 later is one commit.
- Honest trade-off: not open source by the OSI definition; foundations, distributions and some
  corporate allow-lists refuse it as a dependency; fewer contributors and integrations; a two-year-old version is free for anyone, including a competitor. It does not
  stop someone from building a deployment platform or mail server on pennestack unless the BUSL
  grant is tied to "the Licensor's products", which also shuts out legitimate builders of such things.

### Path 2: copyleft with a commercial licence (second)

- Licence: GNU Affero General Public License v3.0 only (SPDX `AGPL-3.0-only`) plus a short
  "pennestack Commercial Licence" (proprietary, per organisation and year, drafted by the lawyer) for
  anyone who will not open their product.
- Trademark and npm as above (`"license": "AGPL-3.0-only"`, the commercial option named in the
  README).
- Contributors: a CLA with sublicensing rights is mandatory, or no contributions; without it the
  second licence cannot be sold.
- What it does: every company that offers a product built on pennestack to users over a network
  must publish that product's source under the AGPL or pay Jens: the only path in which users of the
  framework pay for the framework. Internal use, hobbyists and open-source projects stay free.
- Honest trade-off: AGPL is banned by many corporate policies and avoided by most start-ups, so
  the customers this path targets are the least likely to adopt; the FSF reading that a TypeScript
  import creates a derivative work is contested, so enforcement means a court case; MySQL and Qt
  succeeded with a head start and a brand pennestack lacks, and Ext JS shows the downside.

### Path 3: open framework, protected platforms (third for the goal, first for adoption)

- Licence: Apache License 2.0 (SPDX `Apache-2.0`) on `@pennestack/*`; §6 denies trademark rights and
  §3 brings a patent licence from every contributor; the platforms (Launchway, the mail server) and
  later paid modules under `FSL-1.1-ALv2` or private.
- Trademark: mandatory here; it is the only thing that stays Jens's.
- Contributors: a DCO suffices; a CLA only if path 1 or 2 must stay possible for later versions.
- npm: `"license": "Apache-2.0"`.
- What it does: maximises users, contributors and integrations; Jens earns from the platforms,
  hosting, support and the name; forks keep the code and lose the name.
- Honest trade-off: anyone, forever, may sell hosting and products on every published version; the
  only protections left are the trademark and being first and best.

Recommendation: Path 1 with `FSL-1.1-ALv2` (BUSL-1.1 only if four years matter more than the
simpler, better-known text), the Benelux mark, no code contributions until a CLA exists, and the
repository private until M1 runs. It is the strongest protection that still lets others build on
pennestack, and it turns into Path 3 by one decision, while the reverse is impossible for anything
already published. Path 2 is stronger on paper and weaker in practice; Path 3 is the
right end state if adoption ever outweighs control.

This is research, not legal advice; a Belgian IP lawyer should review the chosen text before
publication.

## 7. Sources

- BUSL 1.1 text, mariadb.com/bsl11 (read 2026-10-26). FSL-1.1-ALv2 template, fsl.software (read
  2026-10-26); Sentry announcement 2023-11-17; SPDX license-list-XML #2459; fair.io (2024).
- Elastic, "Elasticsearch is open source, again", 2024-08-29. Redis AGPL announcement 2025-05-01;
  Valkey launch 2024-03-28; Redis RSALv2/SSPL 2024-03-20.
- HashiCorp BUSL announcement 2023-08-10; CNCF OpenTofu sandbox 2025-04-23; IBM closing 2025-02-27;
  2026 vendor write-ups. CNCF on NATS 2025-05-01; The Register 2025-05-02;
  Synadia blog 2025-05. Liquibase blog 2025-09-30; keycloak/keycloak #43391 (2025-10 to 2026-08).
  Lightbend on Akka 2022-09-07. Directus community (2023, 2025-05).
- PolyForm Small Business 1.0.0 (2019-07-09); n8n LICENSE.md; Prosperity 3.0.0 and Parity 7.0.0.
  wz-it.com licence-change chronicle (read 2026-10-26).
- GitHub Terms of Service D.4 and D.5, effective 2026-04-27; npm Open-Source Terms, 2022-03-10.
- Directive 2009/24/EC art. 1, 5, 6; CJEU C-406/10 (2012-05-02); Directive (EU) 2016/943; Directive
  96/9/EC; WER Book XI (XI.165–XI.167, XI.294–XI.304, XI.332/1 ff.), Justel. EPC art. 52(2)(c), (3);
  EPO Guidelines G-II 3.6; T 1173/97; T 641/00.
- BOIP and EUIPO fees (boip.int, euipo.europa.eu, corroborated 2026-10). Whois and npm registry
  checks, 2026-10-26.
