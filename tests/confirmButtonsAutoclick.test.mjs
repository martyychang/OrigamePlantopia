/**
 * Regression test for https://trello.com/c/uo9guHhd
 * "Make all Confirm buttons auto-confirm"
 *
 * Every status-bar button whose label is EXACTLY "Confirm" must be created with
 * `autoclick: true` so it auto-fires if the player does nothing. Buttons whose
 * label merely starts with "Confirm" (e.g. "Confirm Discard", "Confirm Growth",
 * "Confirm Discard (2 Baby Plants)") are explicitly OUT of scope and must NOT
 * auto-confirm.
 *
 * Scans the real addActionButton call sites in Game.js. If a new exact-"Confirm"
 * button is added later without autoclick, this fails.
 *
 * Run: node tests/confirmButtonsAutoclick.test.mjs
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../plantopia/modules/js/Game.js', import.meta.url), 'utf8');
const lines = src.split('\n');

// A button's options object can sit a few lines below the call when the
// callback is a multi-line arrow function; scan a small window for `autoclick`.
function windowHasAutoclick(startIdx) {
    return lines.slice(startIdx, startIdx + 6).some(l => /autoclick:\s*true/.test(l));
}

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ok  — ${name}`); passed++; }
    catch (e) { console.error(`  FAIL — ${name}\n    ${e.message}`); failed++; }
}

// Exact-"Confirm" buttons: label is _('Confirm') with the closing paren right
// after — so "Confirm Discard" (which is _('Confirm Discard')) never matches.
const exactConfirm = [];
const confirmVariants = [];
lines.forEach((line, i) => {
    if (/addActionButton\(_\('Confirm'\)/.test(line)) exactConfirm.push(i);
    else if (/addActionButton\(_\('Confirm [^']*'\)/.test(line)) confirmVariants.push(i);
});

t('there are exact-"Confirm" buttons to check', () => {
    assert.ok(exactConfirm.length >= 4, `expected >=4 exact Confirm buttons, found ${exactConfirm.length}`);
});

t('every exact-"Confirm" button has autoclick: true', () => {
    for (const idx of exactConfirm) {
        assert.ok(windowHasAutoclick(idx),
            `exact "Confirm" button at Game.js:${idx + 1} is missing autoclick: true`);
    }
});

t('"Confirm <something>" buttons do NOT auto-confirm (exclusion holds)', () => {
    assert.ok(confirmVariants.length >= 1, 'expected at least one "Confirm X" variant to exist');
    for (const idx of confirmVariants) {
        assert.ok(!windowHasAutoclick(idx),
            `"Confirm X" button at Game.js:${idx + 1} should NOT have autoclick (only exact "Confirm" does)`);
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
