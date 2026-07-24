// Resolves the preset through Renovate itself, because the config validator does
// not: it checks schema only and reports "validated successfully" for a preset
// name that does not exist. A typo in `extends` therefore passes validation and
// fails at runtime, in every repository consuming this preset at once.
//
// Resolution alone is not enough either. Preset names that resolve can still be
// the wrong ones: :enableVulnerabilityAlertsWithLabel replaces the label list
// while :enableVulnerabilityAlertsWithAdditionalLabel adds to it, and both
// resolve cleanly. So the settings the README promises are asserted on the
// resolved config.
//
// Only default.json is resolved. renovate.json extends this repo over the network,
// which is not something a PR gate should depend on.
import { readFileSync } from 'node:fs';

const { resolveConfigPresets } = await import('renovate/dist/config/presets/index.js');

const source = JSON.parse(readFileSync(new URL('../default.json', import.meta.url), 'utf8'));

// resolveConfigPresets returns { config, visitedPresets }
const describe = (err) => err.validationError ?? err.validationMessage ?? err.message;

let failed = false;
let resolved;

try {
  ({ config: resolved } = await resolveConfigPresets(source));
  console.log(`ok   default.json resolves: ${source.extends.join(', ')}`);
} catch (err) {
  console.error(`FAIL default.json does not resolve: ${describe(err)}`);
  process.exit(1);
}

// What the README promises, read back off the resolved config.
const contracts = [
  ['every PR is labelled dependencies', resolved.labels?.includes('dependencies')],
  ['vulnerability alerts are enabled', resolved.vulnerabilityAlerts?.enabled === true],
  ['security label is added, not substituted', resolved.vulnerabilityAlerts?.addLabels?.includes('security')],
  ['OSV alerts are on', resolved.osvVulnerabilityAlerts === true],
];

for (const [contract, holds] of contracts) {
  if (holds) {
    console.log(`ok   ${contract}`);
  } else {
    console.error(`FAIL ${contract}`);
    failed = true;
  }
}

// A resolver that accepts anything, or an error path that names nothing, would
// report success above forever.
try {
  await resolveConfigPresets({ extends: ['security:noSuchPresetHere'] });
  console.error('FAIL a nonexistent preset resolved, so this check proves nothing');
  failed = true;
} catch (err) {
  const detail = describe(err);
  if (detail.includes('noSuchPresetHere')) {
    console.log('ok   rejects a nonexistent preset name, and says which one');
  } else {
    console.error(`FAIL rejection message does not name the preset: ${detail}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
