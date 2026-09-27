/**
 * Regression test for https://trello.com/c/ojiekWr4
 * "Inconsistent border highlighting after initiating Plant action then cancelling"
 *
 * Follow-up to the border-standardization card (wSNYx34l). Hand cards used to
 * be RENDERED with a hardcoded green border (`border: 2px solid #2ecc71`) in
 * renderHand's template, so an idle hand (before choosing Plant/Grow/Draw)
 * showed green borders — but cleanupUI clears inline borders to '' on Cancel,
 * leaving the hand borderless. Fresh-render vs. post-cancel were inconsistent.
 *
 * Per the card's acceptance criteria, idle hand cards must have NO border; the
 * green border is drawn ONLY during a "select from hand" step (by
 * markSelectableCard, covered in costCardToggleSelect.test.mjs). This guards
 * the renderHand template so the idle border can't silently come back.
 *
 * Run: node tests/idleHandCardNoBorder.test.mjs
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../plantopia/modules/js/Game.js', import.meta.url), 'utf8');

function extractMethod(name) {
    const re = new RegExp(`\\n    ${name}\\([^)]*\\)\\s*\\{\\n([\\s\\S]*?)\\n    \\}`, 'm');
    const m = src.match(re);
    if (!m) throw new Error(`extractMethod failed for ${name}`);
    return m[1];
}

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ok  — ${name}`); passed++; }
    catch (e) { console.error(`  FAIL — ${name}\n    ${e.message}`); failed++; }
}

const renderHand = extractMethod('renderHand');

// Pull the inline style of the `card_${card.id}` hand-card <div> template.
const cardDiv = renderHand.match(/id="card_\$\{card\.id\}"[^>]*style="([^"]*)"/);

t('renderHand emits a hand-card template', () => {
    assert.ok(cardDiv, 'could not find the card_${card.id} div template in renderHand');
});

t('idle hand card has no visible border (only border-radius allowed)', () => {
    const style = cardDiv[1];
    // Strip border-radius, then assert no remaining `border...:` declaration.
    const withoutRadius = style.replace(/border-radius:[^;]*;?/g, '');
    assert.ok(!/\bborder(-\w+)?\s*:/.test(withoutRadius),
        `idle hand-card style should carry no border, got: "${style}"`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
