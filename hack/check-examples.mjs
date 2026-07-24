// Checks that every annotated example in README.md is matched by the customManager
// that would really process a file of that kind. A documented example that does not
// match is worse than no example: Renovate finds nothing and says nothing.
//
// Scoping matters. The workflows/Makefile regex is loose enough to match a
// Dockerfile snippet it would never be run against, so an example is only ever
// checked against managers whose managerFilePatterns accept the sample filename.
import { readFileSync } from 'node:fs';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const config = JSON.parse(readFileSync(new URL('../default.json', import.meta.url), 'utf8'));

// fence language -> a filename that language's example would live in
const sampleFile = {
  dockerfile: 'Containerfile',
  yaml: '.github/workflows/pr.yaml',
  makefile: 'Makefile',
};

// managerFilePatterns holds slash-delimited regexes: /^Makefile$/
const toRegExp = (pattern) => new RegExp(pattern.replace(/^\/|\/$/g, ''));

const blocks = [...readme.matchAll(/```(\w+)\n([\s\S]*?)```/g)]
  .map((m) => ({ lang: m[1], body: m[2] }))
  .filter((b) => b.body.includes('# renovate:'));

if (blocks.length === 0) {
  console.error('no annotated examples found in README.md — did the fence language or the annotation change?');
  process.exit(1);
}

let failed = false;

for (const block of blocks) {
  const file = sampleFile[block.lang];
  if (!file) {
    console.error(`FAIL ${block.lang} example is annotated but this check has no sample filename for it`);
    failed = true;
    continue;
  }

  const managers = config.customManagers.filter((cm) =>
    cm.managerFilePatterns.some((p) => toRegExp(p).test(file)),
  );
  const hits = managers
    .flatMap((cm) => cm.matchStrings)
    .flatMap((ms) => [...block.body.matchAll(new RegExp(ms, 'g'))]);

  if (hits.length === 0) {
    console.error(`FAIL ${block.lang} example is not matched by any manager that runs on ${file}`);
    failed = true;
    continue;
  }

  for (const hit of hits) {
    const { depName, currentValue } = hit.groups;
    // "loose" and friends show up when the annotation drifts away from the pinned
    // token and the regex captures a fragment of the annotation itself.
    if (!/^v?\d/.test(currentValue)) {
      console.error(`FAIL ${block.lang} example: ${depName} captured currentValue "${currentValue}", which is not a version`);
      failed = true;
      continue;
    }
    console.log(`ok   ${block.lang} example (${file}): ${depName} -> ${currentValue}`);
  }
}

process.exit(failed ? 1 : 0);
