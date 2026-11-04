# @keelwerk/biome-config

The Biome preset of keelwerk projects (architecture section 13.9). Extend it from `biome.json`:

```json
{ "extends": ["@keelwerk/biome-config/biome"] }
```

It enables the layout, determinism and import-boundary rules that Biome ships natively, with
Biome's formatter defaults except single quotes, two spaces and 100 columns.

## Planned GritQL plugins

Not shipped yet (roadmap M0); each comes with fixtures:

- `named-module-types`, `as-system-reason`, `no-null-in-conditions`, `pure-parts`,
  `no-module-state`, `no-await-in-parts`, `error-code-format`, `no-selection-augmentation`,
  `one-export` and `no-import-effects`, `wiring-only-assembly`.
