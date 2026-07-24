# renovate-config

Shared [Renovate](https://docs.renovatebot.com/) preset for `lexfrei` repositories — one source of truth for dependency-automation policy.

## Usage

In a repository's `renovate.json`:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>lexfrei/renovate-config"]
}
```

Add per-repo overrides after the `extends` as needed.

## What it sets

- `config:recommended` + semantic-commit chore prefixes, no PR rate/concurrency limits, every PR labelled `dependencies`.
- `platformAutomerge` (squash) and automerge for minor/patch/pin/digest plus all GitHub Actions updates.
- GitHub Action refs pinned to digests (`helpers:pinGitHubActionDigests`).
- `docker:enableMajor`, which states the default rather than changing it: Renovate already proposes major image updates, and nothing in `config:recommended` turns them off. It is here so a future `docker:disableMajor` in some consumer repo has to be a deliberate, visible override.
- `postUpdateOptions: gomodTidy` and `gomodUpdateImportPaths`, so `go.mod`/`go.sum` stay tidy and a Go major bump rewrites the `/vN` import paths in the code.
- `go` directive in `go.mod` bumped (`rangeStrategy: bump`) — CI must use `GOTOOLCHAIN=auto` or a matching `setup-go` so the runner can build the new directive.
- **`controller-runtime` grouped with `k8s.io/*`** under one `kubernetes` group, so they always bump together (a split bump breaks compilation).
- A regex `customManager` that bumps any tool version annotated with a `# renovate: datasource=… depName=…` comment in workflows or the repository's root `Makefile` (golangci-lint, go, templ, …). Seed the workflow with a concrete `version: vX.Y.Z` once; Renovate keeps it current after that.
- A second regex `customManager` for apk packages pinned in a `Containerfile` or `Dockerfile` — see below.
- **Vulnerability fixes, including indirect Go modules** — see below.

## Vulnerability fixes

Renovate marks every `// indirect` entry in `go.mod` as disabled, so on a stock config a transitive module with a known advisory is never proposed at all. Switching vulnerability alerts on is what moves most of those fixes: an alert-driven update carries a `force` block, with alerts enabled that block holds `enabled: true`, and package rules are applied before the disabled check, so the dependency is re-opened for that one fix.

`security:gomodIndirectSecurityUpdates` covers what `force` cannot reach on its own. The alert's rule has to match the dependency before any lookup, and it matches on the current version, which fails for a Go pseudo-version like `v0.0.0-20230101000000-abcdef123456` when the advisory states a range rather than an exact version. The preset enables indirect gomod deps unconditionally and then disables every non-security update type for them, which makes that case reachable without letting routine indirect updates through. Measured against this preset with the preset rules removed but alerts still on: three of the four alert shapes produce the fix anyway, and pseudo-version with a range advisory is the one that does not.

Advisories come from two independent sources: GitHub's Dependabot alerts, which need the Dependency graph and Dependabot alerts switched on in the repository's security settings, and the OSV database (`osvVulnerabilityAlerts`), which carries the Go vulnerability database in addition to GitHub's advisories and is still marked experimental upstream. Fixes carry a `security` label on top of the usual `dependencies` one — create that label in the repository if it isn't there — and a minor or patch fix automerges like any other.

The cost is lookups. The rule that suppresses non-security updates can only apply once an update type is known, which is after the lookup, so every `// indirect` entry gets a datasource lookup on every run and the result is thrown away unless an advisory names it. On a repo built on controller-runtime that is a few hundred extra lookups per run and no extra PRs. What they buy is the pseudo-version case above, not indirect coverage as a whole.

Renovate's own documentation says OSV alerts cover direct dependencies only, which reads like a contradiction here. It is not: `go.mod` lists indirect requirements explicitly, unlike a `package.json`, so they arrive as ordinary extracted dependencies and the OSV scan sees them.

## golangci-lint pinning

Pin the linter once per repo so a new release can't silently turn the required Lint check red:

```yaml
      - uses: golangci/golangci-lint-action@v9
        with:
          # renovate: datasource=github-releases depName=golangci/golangci-lint
          version: v2.12.2
```

The `customManager` above then bumps `v2.12.2` via controlled PRs.

## Pinned apk packages

An unpinned `apk add` gives a different image on every build. Pin the version and annotate it, and Renovate keeps the pin current from [Repology](https://repology.org/):

```dockerfile
RUN apk add --no-cache \
    # renovate: datasource=repology depName=alpine_3_22/upx
    upx=5.0.1-r0
```

`depName` is `alpine_<major>_<minor>/<package>`, matching the Alpine release the base image comes from. Without the annotation the manager does nothing, so this is opt-in per package.

The annotation has to sit directly above the pinned token, with nothing but whitespace in between — that is what the manager's regex looks for. Put it above the whole `RUN` line instead and the match silently fails, and if the annotation also carries `versioning=`, the regex matches the wrong half and tracks a dependency whose version is the string `loose`.
