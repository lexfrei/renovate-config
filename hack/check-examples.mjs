// Checks that every annotated example in README.md is matched by the customManager
// that would really process a file of that kind. A documented example that does not
// match is worse than no example: Renovate finds nothing and says nothing.
//
// Three traps this guards against, each of which shipped at some point. Scoping:
// the workflows regex is loose enough to match a Dockerfile snippet it would never
// run against, so an example is only checked against managers whose
// managerFilePatterns accept the sample filename. Counting: an `apk add` block
// usually pins several packages, so every annotation has to match, not just one.
// Capture sanity: a regex that swallows the wrong span still "matches", and hands
// Renovate a depName with a space in it or a version reading `loose`.
//
// matchStrings are compiled with RE2, the way Renovate compiles them, so a
// construct RE2 rejects (a lookahead, say) fails here instead of passing CI and
// failing in production. RE2 arrives as one of renovate's own dependencies; if it
// is missing this falls back to JS RegExp and says so.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

let RE2;
try {
  RE2 = createRequire(import.meta.url)('re2');
} catch {
  // Falling back silently would leave the check green while it quietly stopped
  // testing what it claims to. CI sets REQUIRE_RE2 so the degraded mode cannot
  // pass there; locally it stays a warning.
  const message = 're2 is not installed, so RE2-only failures will not be caught';
  if (process.env.REQUIRE_RE2) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
  console.log(`note ${message}`);
}

const compile = (pattern, flags) => (RE2 ? new RE2(pattern, flags) : new RegExp(pattern, flags));

const config = JSON.parse(readFileSync(new URL('../default.json', import.meta.url), 'utf8'));

// fence language -> a filename that language's example would live in
const sampleFile = {
  dockerfile: 'Containerfile',
  yaml: '.github/workflows/pr.yaml',
};

// managerFilePatterns holds slash-delimited regexes, optionally with flags:
// /^Makefile$/ or /dockerfile$/i. Renovate also accepts globs and negation, and
// this check cannot evaluate either, so it says so instead of guessing.
function toRegExp(pattern) {
  if (pattern.startsWith('!')) {
    throw new Error(`managerFilePatterns entry ${pattern} is negated, which this check cannot evaluate`);
  }
  // Renovate accepts a trailing `i` and nothing else; /p/gm is treated as a glob
  // there, so accepting it here would report a match Renovate never makes.
  const match = /^\/(.*)\/(i?)$/.exec(pattern);
  if (!match) {
    throw new Error(`managerFilePatterns entry ${pattern} is a glob, which this check cannot evaluate`);
  }
  return compile(match[1], match[2]);
}

function problemsIn(lang, body, expected = {}) {
  const file = sampleFile[lang];
  if (!file) {
    return [`${lang} example is annotated but this check has no sample filename for that language`];
  }

  const hits = config.customManagers
    .filter((cm) => cm.managerFilePatterns.some((p) => toRegExp(p).test(file)))
    .flatMap((cm) => cm.matchStrings)
    .flatMap((ms) => [...body.matchAll(compile(ms, 'g'))]);

  const annotations = (body.match(/# renovate:/g) ?? []).length;
  const problems = [];

  if (hits.length !== annotations) {
    problems.push(`${lang}: ${hits.length} of ${annotations} annotations matched a manager that runs on ${file}`);
  }

  for (const hit of hits) {
    const { groups } = hit;
    if (!groups) {
      problems.push(`${lang}: a matchString matched without named capture groups`);
      continue;
    }
    // A version reading "loose" or a depName with a space in it means the regex
    // captured part of the annotation instead of the value next to it.
    if (!/^v?\d/.test(groups.currentValue)) {
      problems.push(`${lang}: ${groups.depName} captured currentValue "${groups.currentValue}", which is not a version`);
    }
    if (/\s/.test(groups.depName)) {
      problems.push(`${lang}: captured depName "${groups.depName}" contains whitespace`);
    }
    for (const [group, want] of Object.entries(expected)) {
      if (groups[group] !== want) {
        problems.push(`${lang}: captured ${group} "${groups[group]}", expected "${want}"`);
      }
    }
  }

  return problems;
}

// Fixtures, kept here so both paths run on every invocation. A checker that has
// never rejected anything is indistinguishable from one that cannot.
const mustFail = [
  ['annotation above the RUN line', 'dockerfile', `
# renovate: datasource=repology depName=alpine_3_22/upx
RUN apk add --no-cache upx=5.0.1-r0
`],
  ['misplaced annotation carrying versioning=', 'dockerfile', `
# renovate: datasource=repology depName=alpine_3_22/upx versioning=loose
RUN apk add --no-cache upx=5.0.1-r0
`],
  ['one good pin and one misplaced', 'dockerfile', `
# renovate: datasource=repology depName=alpine_3_22/upx
RUN apk add --no-cache upx=5.0.1-r0 \\
    # renovate: datasource=repology depName=alpine_3_22/curl
    curl=8.14.1-r1
`],
  // The adjacency rule is not an apk quirk, it applies to the workflow manager too.
  ['workflow annotation separated from the version', 'yaml', `
        with:
          # renovate: datasource=github-releases depName=golangci/golangci-lint
          args: --timeout 5m
          version: v2.12.2
`],
  ['workflow annotation above the uses line', 'yaml', `
        # renovate: datasource=github-releases depName=golangci/golangci-lint
        uses: golangci/golangci-lint-action@v9
        with:
          version: v2.12.2
`],
];

// The expected groups matter: without them a regex that drops the versioning
// capture still passes, because depName and currentValue come out clean.
const mustPass = [
  ['workflow annotation carrying versioning=', 'yaml', `
        with:
          # renovate: datasource=github-releases depName=golangci/golangci-lint versioning=semver
          version: v2.12.2
`, { depName: 'golangci/golangci-lint', versioning: 'semver', currentValue: 'v2.12.2' }],
  ['apk pin with versioning=', 'dockerfile', `
RUN apk add --no-cache \\
    # renovate: datasource=repology depName=alpine_3_22/upx versioning=loose
    upx=5.0.1-r0
`, { depName: 'alpine_3_22/upx', versioning: 'loose', currentValue: '5.0.1-r0' }],
];

let failed = false;

for (const [name, lang, body] of mustFail) {
  if (problemsIn(lang, body).length === 0) {
    console.error(`FAIL fixture "${name}" is broken but the check accepted it`);
    failed = true;
  } else {
    console.log(`ok   rejects: ${name}`);
  }
}

for (const [name, lang, body, expected] of mustPass) {
  const problems = problemsIn(lang, body, expected);
  if (problems.length > 0) {
    console.error(`FAIL fixture "${name}" is valid but the check rejected it: ${problems.join('; ')}`);
    failed = true;
  } else {
    console.log(`ok   accepts: ${name}`);
  }
}

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const blocks = [...readme.matchAll(/```(\w+)\n([\s\S]*?)```/g)]
  .map((m) => ({ lang: m[1], body: m[2] }))
  .filter((b) => b.body.includes('# renovate:'));

if (blocks.length === 0) {
  console.error('FAIL no annotated examples found in README.md — did the fence language or the annotation change?');
  failed = true;
}

for (const block of blocks) {
  const problems = problemsIn(block.lang, block.body);
  for (const problem of problems) {
    console.error(`FAIL README ${problem}`);
  }
  if (problems.length === 0) {
    console.log(`ok   README ${block.lang} example matches ${sampleFile[block.lang]}`);
  }
  failed ||= problems.length > 0;
}

process.exit(failed ? 1 : 0);
