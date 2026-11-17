# Case Vortex graph

The case graph behind Case Vortex: a deterministic engine that works out which
records in an archive of sighting reports, documents, photos and videos are
related, records why, and publishes the result as a versioned, hash-verified
graph.

This repository is the graph engine on its own, extracted from a larger private
platform. It has no web front end, no ingestion pipelines and no data. It is
published so the engine and its tests can be read, run and built on.

## What it does

1. **Evidence universe.** Every record becomes a node with a stable address.
2. **Facts.** Each record is reduced to typed facts in six families: visual,
   behavioural, sensory, entity, site and narrative pattern. Every fact carries
   a confidence, a precision and a missing-or-uncertain status.
3. **Rarity.** A match on a rare value counts for more than a match on a
   common one.
4. **Typed relationships.** Fixed rules compare pairs of records and emit typed
   edges such as `space_time_candidate`, `shared_visual` or
   `duplicate_provenance`. No model is involved at this stage.
5. **Source dependency.** Each pair is classed as independent, dependent or
   unknown, so two copies of one report are not counted as corroboration.
6. **Context.** Separate modules check ordinary explanations against outside
   data such as aircraft, weather, satellites and balloons.
7. **Publication.** The output is a set of archives and a manifest. Each stage
   names the hash of what it was built from.

An edge means two records share bounded evidence. It never claims that one
thing caused another, or that a report is true.

## Requirements

- Node.js 22
- About 4 GB of memory for the full test suite

## Getting started

```bash
npm ci
npm run typecheck
npm test
```

The full suite runs with one worker by default, because some tests build large
fixtures. It takes several minutes. To run one area:

```bash
npx vitest run tests/caseGraph/typedRelationshipEngine.test.ts
```

Set `VITEST_MAX_WORKERS` to use more workers if you have the memory.

The tests run offline. They need no credentials and no running database.

## Layout

| Path | Contents |
|---|---|
| `src/caseGraph` | The engine: relationship inputs, rarity, typed relationships, calibration, archives, publication |
| `src/db/migrations` | The database migrations the graph's control plane expects |
| `src/cli`, `src/db`, `src/utils`, `src/sky`, `src/services`, `src/workers`, `src/shared` | The small set of platform modules the engine imports |
| `tests/caseGraph` | The test suite and its fixtures |

## Design rules

- **Deterministic.** The same inputs give byte-identical outputs.
- **Hash-bound.** Every artefact records the digest of its inputs.
- **Versioned.** A format change bumps a version constant.
- **Conservative.** Missing or negated facts never create an edge, and
  narrative similarity alone never does.

## Status

This is working code from a production system, published as it is. The public
interfaces are not yet stable.

## Licence

MIT. See [LICENSE](LICENSE).
