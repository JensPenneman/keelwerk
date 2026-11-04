# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub:
<https://github.com/JensPenneman/keelwerk/security/advisories/new>

Do not report security problems in public issues, pull requests or discussions.

Please include:

- the affected package and the version or commit;
- steps to reproduce, or a proof of concept;
- the impact as you understand it.

You will receive an acknowledgement within 3 business days. We will keep you informed while a fix
is prepared and agree on the disclosure with you. Reporters are credited in the published advisory
unless they prefer not to be.

## Supported versions

keelwerk is pre-1.0 and in beta. Security fixes are made for the latest release only; upgrade to
receive them.

| Version | Supported |
|---|---|
| Latest 0.x release | Yes |
| Older releases | No |

## Supply chain

The repository uses CodeQL, Dependabot (weekly grouped updates, security updates in pull requests
of their own). Dependencies are pinned to exact versions,
every commit on `main` is signed, and GitHub Actions are pinned by commit.
