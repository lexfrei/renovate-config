// Checks that every annotated example in README.md is matched by the customManager
// that would really process a file of that kind. A documented example that does not
// match is worse than no example: Renovate finds nothing and says nothing.
//
// Two things this got wrong before and now guards against. Scoping: the
// workflows regex is loose enough to match a Dockerfile snippet it would never
// run against, so an example is only checked against managers whose
// managerFilePatterns accept the sample filename. Counting: an `apk add` block
// usually pins several packages, so every annotation in a block has to match, not
// just one of them.
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../default.json', import.meta.url), 'utf8'));

// fence language -> a filename that language's example would live in
const sampleFile = {
  dockerfile: 'Containerfile',
  yaml: '.github/workflows/pr.yaml',
};

// managerFilePatterns holds slash-delimited regexes: /^Makefile$/
const toRegExp = (pattern) => new RegExp(pattern.replace(/^\/|\/$/g, ''));

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
    problems.push(`${lang} example: ${hits.length} of ${annotations} annotations matched a manager that runs on ${file}`);
  }

  for (const { groups } of hits) {
    // "loose" and friends show up when the annotation drifts away from the pinned
    // token and the regex captures a fragment of the annotation itself.
    if (!/^v?\d/.test(groups.currentValue)) {
      problems.push(`${lang} example: ${groups.depName} captured currentValue "${groups.currentValue}", which is not a version`);
    }
  }

  return problems;
}

// Known-bad snippets, kept here so the rejection path runs on every CI run. A
// checker that has never rejected anything is indistinguishable from one that
// cannot.
const mustFail = {
  'annotation above the RUN line': `
# renovate: datasource=repology depName=alpine_3_22/upx
RUN apk add --no-cache upx=5.0.1-r0
`,
  'misplaced annotation carrying versioning=': `
# renovate: datasource=repology depName=alpine_3_22/upx versioning=loose
RUN apk add --no-cache upx=5.0.1-r0
`,
  'one good pin and one misplaced': `
# renovate: datasource=repology depName=alpine_3_22/upx
RUN apk add --no-cache upx=5.0.1-r0 \\
    # renovate: datasource=repology depName=alpine_3_22/curl
    curl=8.14.1-r1
`,
};

let failed = false;

for (const [name, body] of Object.entries(mustFail)) {
  if (problemsIn('dockerfile', body).length === 0) {
    console.error(`FAIL self-test: "${name}" is broken but the check accepted it`);
    failed = true;
  } else {
    console.log(`ok   self-test rejects: ${name}`);
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
    console.error(`FAIL ${problem}`);
  }
  if (problems.length === 0) {
    console.log(`ok   ${block.lang} example matches ${sampleFile[block.lang]}`);
  }
  failed ||= problems.length > 0;
}

process.exit(failed ? 1 : 0);
