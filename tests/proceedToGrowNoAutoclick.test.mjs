/**
 * Regression test for https://trello.com/c/BV5CFDI6
 * "Disable auto-proceed on button: Proceed to Grow Plants"
 *
 * The "Proceed to Grow Plants" button used to auto-click (autoclick: true) in
 * the no-bonus-weather branch (Trello 7R6Ov64N), which rushed players past the
 * Weather Phase before they could see what weather was played and why their
 * plants grew (BGA bug #246723). Auto-proceed is now DISABLED — every "Proceed
 * to Grow Plants" button must be a plain manual button with no autoclick.
 *
 * This guards against the auto-proceed being reintroduced.
 *
 * Run: node tests/proceedToGrowNoAutoclick.test.mjs
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../plantopia/modules/js/Game.js', import.meta.url), 'utf8');
const lines = src.split('\n');

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ok  — ${name}`); passed++; }
    catch (e) { console.error(`  FAIL — ${name}\n    ${e.message}`); failed++; }
}

const proceedLines = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => /addActionButton\(_\('Proceed to Grow Plants'\)/.test(l));

t('there are "Proceed to Grow Plants" buttons to check', () => {
    assert.ok(proceedLines.length >= 1, `expected >=1, found ${proceedLines.length}`);
});

t('no "Proceed to Grow Plants" button has autoclick (auto-proceed disabled)', () => {
    for (const { l, i } of proceedLines) {
        // the options object is on the same line for these call sites
        assert.ok(!/autoclick/.test(l),
            `"Proceed to Grow Plants" at Game.js:${i + 1} must not auto-proceed (Trello BV5CFDI6)`);
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
