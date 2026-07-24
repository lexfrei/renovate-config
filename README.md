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
- Major container base-image updates allowed (`docker:enableMajor`) — off in `config:recommended`, so this is a real policy change for anything with a `Containerfile`.
- `postUpdateOptions: gomodTidy` and `gomodUpdateImportPaths`, so `go.mod`/`go.sum` stay tidy and a Go major bump rewrites the `/vN` import paths in the code.
- `go` directive in `go.mod` bumped (`rangeStrategy: bump`) — CI must use `GOTOOLCHAIN=auto` or a matching `setup-go` so the runner can build the new directive.
- **`controller-runtime` grouped with `k8s.io/*`** under one `kubernetes` group, so they always bump together (a split bump breaks compilation).
- A regex `customManager` that bumps any tool version annotated with a `# renovate: datasource=… depName=…` comment in workflows or the `Makefile` (golangci-lint, go, templ, …). Seed the workflow with a concrete `version: vX.Y.Z` once; Renovate keeps it current after that.
- A second regex `customManager` for apk packages pinned in a `Containerfile` or `Dockerfile` — see below.
- **Vulnerability fixes, including indirect Go modules** — see below.

## Vulnerability fixes

`security:gomodIndirectSecurityUpdates` turns on lookups for `// indirect` entries in `go.mod` and then disables every non-security update type for them, so a transitive module is bumped only when an advisory names it. Renovate attaches a `force` block to alert-driven updates that re-enables the dependency for that one fix, which is what lets the fix through the blanket disable. Without this, an indirect module with a known vulnerability sits at its old version forever: Renovate skips indirect dependencies by default, so nothing ever proposes the bump.

Advisories come from two independent sources: GitHub's Dependabot alerts, which need the Dependency graph and Dependabot alerts switched on in the repository's security settings, and the OSV database (`osvVulnerabilityAlerts`), which carries the Go vulnerability database and usually has Go advisories first. Fixes carry a `security` label on top of the usual `dependencies` one — create that label in the repository if it isn't there — and a minor or patch fix automerges like any other.

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
# renovate: datasource=repology depName=alpine_3_22/upx
RUN apk add --no-cache upx=5.0.1-r0
```

`depName` is `alpine_<major>_<minor>/<package>`, matching the Alpine release the base image comes from. Without the annotation the manager does nothing, so this is opt-in per package.
