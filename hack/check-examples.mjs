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
// Caveat worth knowing: Renovate compiles matchStrings with RE2, this runs them
// through JS RegExp. Constructs RE2 rejects, lookaheads in particular, pass here
// and fail in production.
import { readFileSync } from 'node:fs';

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
  const match = /^\/(.*)\/([a-z]*)$/.exec(pattern);
  if (!match) {
    throw new Error(`managerFilePatterns entry ${pattern} is a glob, which this check cannot evaluate`);
  }
  return new RegExp(match[1], match[2]);
}

function problemsIn(lang, body) {
  const file = sampleFile[lang];
  if (!file) {
    return [`${lang} example is annotated but this check has no sample filename for that language`];
  }

  const hits = config.customManagers
    .filter((cm) => cm.managerFilePatterns.some((p) => toRegExp(p).test(file)))
    .flatMap((cm) => cm.matchStrings)
    .flatMap((ms) => [...body.matchAll(new RegExp(ms, 'g'))]);

  const annotations = (body.match(/# renovate:/g) ?? []).length;
  const problems = [];

  if (hits.length !== annotations) {
    problems.push(`${lang}: ${hits.length} of ${annotations} annotations matched a manager that runs on ${file}`);
  }

  for (const { groups } of hits) {
    // A version reading "loose" or a depName with a space in it means the regex
    // captured part of the annotation instead of the value next to it.
    if (!/^v?\d/.test(groups.currentValue)) {
      problems.push(`${lang}: ${groups.depName} captured currentValue "${groups.currentValue}", which is not a version`);
    }
    if (/\s/.test(groups.depName)) {
      problems.push(`${lang}: captured depName "${groups.depName}" contains whitespace`);
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
];

const mustPass = [
  ['workflow annotation carrying versioning=', 'yaml', `
        with:
          # renovate: datasource=github-releases depName=golangci/golangci-lint versioning=semver
          version: v2.12.2
`],
  ['apk pin with versioning=', 'dockerfile', `
RUN apk add --no-cache \\
    # renovate: datasource=repology depName=alpine_3_22/upx versioning=loose
    upx=5.0.1-r0
`],
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

for (const [name, lang, body] of mustPass) {
  const problems = problemsIn(lang, body);
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
