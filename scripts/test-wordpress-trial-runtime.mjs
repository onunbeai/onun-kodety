import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../Wordpress/editor/wordpress-trial-runtime.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { trialRemainingMs, expireTrialProduct, installWordPressTrialRuntime } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const oldTrial = {
  edition: 'pro', licensed: false, licenseIsTrial: true, licenseTrialExpired: true,
  licenseExpiresAt: '2000-01-01T00:00:00Z', licenseStatusUrl: 'https://old.example/license',
  features: { visualBuilder: true, ai: true, localization: false }, limits: { collections: 1 },
  licenseUrl: 'https://old.example/activate', upgradeUrl: 'https://old.example/buy',
};
const migrated = expireTrialProduct(oldTrial);
assert.equal(migrated.licensed, true);
assert.equal(migrated.licenseIsTrial, false);
assert.equal(migrated.licenseTrialExpired, false);
assert.equal(migrated.licenseExpiresAt, '');
assert.equal(migrated.limits.collections, null);
assert.equal(migrated.licenseUrl, '');
assert.equal(migrated.upgradeUrl, '');
assert.equal(migrated.licenseStatusUrl, '');
assert.deepEqual(migrated.features, oldTrial.features, 'Optional extension installation state must be preserved.');
assert.equal(trialRemainingMs(oldTrial, Number.MAX_SAFE_INTEGER), Infinity);
const forbidden = () => { throw new Error('Trial migration must not poll, register a timer, or contact an activation service.'); };
const host = { kodetyWordPress: { product: oldTrial }, fetch: forbidden, setTimeout: forbidden, setInterval: forbidden, addEventListener: forbidden };
installWordPressTrialRuntime(host)();
assert.deepEqual(host.kodetyWordPress.product, migrated);
console.log('WordPress open-source access survives legacy trial data without timers or requests.');
