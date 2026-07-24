// Resolves the preset through Renovate itself, because the config validator does
// not: it checks schema only and reports "validated successfully" for a preset
// name that does not exist. A typo in `extends` therefore passes validation and
// fails at runtime, in every repository consuming this preset at once.
//
// Only default.json is resolved. renovate.json extends this repo over the network,
// which is not something a PR gate should depend on.
import { readFileSync } from 'node:fs';

const { resolveConfigPresets } = await import('renovate/dist/config/presets/index.js');

const config = JSON.parse(readFileSync(new URL('../default.json', import.meta.url), 'utf8'));

let failed = false;

try {
  await resolveConfigPresets(config);
  console.log(`ok   default.json resolves: ${config.extends.join(', ')}`);
} catch (err) {
  console.error(`FAIL default.json does not resolve: ${err.validationMessage ?? err.message}`);
  failed = true;
}

// A resolver that accepts anything would report success above forever.
try {
  await resolveConfigPresets({ extends: ['security:noSuchPresetHere'] });
  console.error('FAIL a nonexistent preset resolved, so this check proves nothing');
  failed = true;
} catch {
  console.log('ok   rejects: nonexistent preset name');
}

process.exit(failed ? 1 : 0);
