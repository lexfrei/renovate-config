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

- `config:recommended` + semantic-commit chore prefixes, no PR rate/concurrency limits.
- `platformAutomerge` (squash) and automerge for minor/patch/pin/digest plus all GitHub Actions updates.
- GitHub Action refs pinned to digests (`helpers:pinGitHubActionDigests`).
- `go` directive in `go.mod` bumped (`rangeStrategy: bump`) — CI must use `GOTOOLCHAIN=auto` or a matching `setup-go` so the runner can build the new directive.
- **`controller-runtime` grouped with `k8s.io/*`** under one `kubernetes` group, so they always bump together (a split bump breaks compilation).
- A regex `customManager` that bumps any tool version annotated with a `# renovate: datasource=… depName=…` comment in workflows or the `Makefile` (golangci-lint, go, templ, …). Seed the workflow with a concrete `version: vX.Y.Z` once; Renovate keeps it current after that.
- **Vulnerability fixes, including indirect Go modules** — see below.

## Vulnerability fixes

`security:gomodIndirectSecurityUpdates` turns on lookups for `// indirect` entries in `go.mod` and then disables every non-security update type for them, so a transitive module is bumped only when an advisory names it. Renovate attaches a `force` block to alert-driven updates that re-enables the dependency for that one fix, which is what lets the fix through the blanket disable. Without this, an indirect module with a known vulnerability sits at its old version forever: Renovate skips indirect dependencies by default, so nothing ever proposes the bump.

Advisories come from two independent sources. GitHub's Dependabot alerts, which need the Dependency graph and Dependabot alerts switched on in the repository's security settings, and the OSV database (`osvVulnerabilityAlerts`), which carries the Go vulnerability database and usually has Go advisories first. Fix PRs skip the usual rate and concurrency limits, and a minor or patch fix is automerged by the rules above.

## golangci-lint pinning

Pin the linter once per repo so a new release can't silently turn the required Lint check red:

```yaml
      - uses: golangci/golangci-lint-action@v9
        with:
          # renovate: datasource=github-releases depName=golangci/golangci-lint
          version: v2.12.2
```

The `customManager` above then bumps `v2.12.2` via controlled PRs.
