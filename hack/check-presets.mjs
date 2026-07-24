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
//
// The import below is an internal path and renovate is installed unpinned, so an
// upstream reshuffle shows up here as ERR_MODULE_NOT_FOUND rather than as a
// config problem. Same tradeoff as the floating validator in the workflow.
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

// The indirect-gomod pair is the point of the whole preset, and both rules plus
// their order have to survive: the disable has to come after the enable, and no
// later rule may put `enabled` back for these deps.
const rules = resolved.packageRules ?? [];
const isIndirectGomod = (r) => r.matchDepTypes?.includes('indirect') && r.matchManagers?.includes('gomod');
const enableAt = rules.findIndex((r) => isIndirectGomod(r) && r.enabled === true);
const disableAt = rules.findIndex((r) => isIndirectGomod(r) && r.enabled === false && r.matchUpdateTypes?.length);

contracts.push(
  ['indirect gomod deps are enabled for lookup', enableAt !== -1],
  ['non-security updates are disabled for them', disableAt !== -1],
  ['the disable comes after the enable', enableAt !== -1 && disableAt > enableAt],
  [
    'no later rule re-enables them',
    disableAt !== -1 && !rules.slice(disableAt + 1).some((r) => r.enabled !== undefined),
  ],
);

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
