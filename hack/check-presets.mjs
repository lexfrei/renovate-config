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

// The claim worth pinning is behavioural, not structural: an indirect Go module
// named by an advisory has to survive both rule stages. Renovate marks every
// `// indirect` entry disabled at extraction, and it is the alert's force block
// that re-opens it, so this drives renovate's own applyPackageRules the way
// fetch.js does rather than asserting on rule shapes.
const { applyPackageRules } = await import('renovate/dist/util/package-rules/index.js');
const { mergeChildConfig } = await import('renovate/dist/config/utils.js');
const { getDefaultVersioning } = await import('renovate/dist/modules/datasource/common.js');
const { getDefaultConfig } = await import('renovate/dist/modules/datasource/index.js');

// A pseudo-version dep carries a digest, and the gomod extractor pins it to
// `loose` versioning, which cannot evaluate a range at all.
const deps = {
  release: { depName: 'example.com/rel', packageName: 'example.com/rel', manager: 'gomod', depType: 'indirect', datasource: 'go', currentValue: 'v1.0.0', enabled: false },
  pseudo: { depName: 'example.com/pseudo', packageName: 'example.com/pseudo', manager: 'gomod', depType: 'indirect', datasource: 'go', currentValue: 'v0.0.0-20230101000000-abcdef123456', versioning: 'loose', currentDigest: 'abcdef123456', enabled: false },
};

// GitHub alerts state a range, OSV states the exact affected version.
const alertRule = (base, dep, shape) => ({
  matchDatasources: ['go'],
  matchPackageNames: [dep.packageName],
  matchCurrentVersion: shape === 'range' ? '< 1.2.3' : dep.currentValue,
  isVulnerabilityAlert: true,
  force: { ...base.vulnerabilityAlerts },
});

async function fixReaches(base, dep, shape) {
  const config = { ...base, packageRules: [...(base.packageRules ?? []), alertRule(base, dep, shape)] };
  let depConfig = mergeChildConfig(config, dep);
  depConfig = mergeChildConfig(depConfig, await getDefaultConfig(depConfig.datasource));
  depConfig.versioning ??= getDefaultVersioning(depConfig.datasource);
  const looked = await applyPackageRules(depConfig, 'pre-lookup');
  if (looked.enabled === false) {
    return false;
  }
  const merged = await applyPackageRules({ ...looked, updateType: 'patch', newValue: 'v1.2.3' }, 'update-type-merge');
  return merged.enabled !== false;
}

// Same config with vulnerability alerts left at renovate's default, which has no
// `enabled` key at all. If this still produced fixes, the ones above would prove
// nothing about what this preset contributes.
const withoutAlerts = { ...resolved, vulnerabilityAlerts: { groupName: null } };

contracts.push(
  ['a range advisory reaches a release-version indirect dep', await fixReaches(resolved, deps.release, 'range')],
  ['an exact advisory reaches a release-version indirect dep', await fixReaches(resolved, deps.release, 'exact')],
  ['an exact advisory reaches a pseudo-version indirect dep', await fixReaches(resolved, deps.pseudo, 'exact')],
  ['a range advisory cannot reach a pseudo-version, as documented', (await fixReaches(resolved, deps.pseudo, 'range')) === false],
  ['none of this works without vulnerability alerts enabled', (await fixReaches(withoutAlerts, deps.release, 'range')) === false],
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
