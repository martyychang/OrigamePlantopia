/**
 * Regression test for https://trello.com/c/hsdoZGId
 * "Allow clicking on selected card to deselect the card"
 *
 * The discard-cost / fertilizer selection used to be add-only: once a hand
 * card was clicked it was locked into `selectedPaymentCards` until Cancel,
 * and the planting branch auto-confirmed the instant the cost was met — so
 * there was never a chance to deselect. `highlightHandCardsForCost(cost,
 * onChange)` now toggles: an unselected card (up to `cost`) selects, an
 * already-selected card deselects, and clicking a new card while at the cap
 * is a no-op. (The draft "keep" modal already toggled; this brings the cost
 * selection in line.)
 *
 * Drives the REAL PlantingPhase.highlightHandCardsForCost extracted from
 * Game.js against a fake `this` + a minimal `document` stub (Node only, no
 * DOM/Chrome).
 *
 * Run: node tests/costCardToggleSelect.test.mjs
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

// Minimal fake DOM elements keyed by `card_<id>`.
function makeEls(ids) {
    const els = {};
    for (const id of ids) {
        els[`card_${id}`] = {
            classList: { add() {}, remove() {} },
            style: {},
            onclick: null,
        };
    }
    return els;
}

function buildCtx(handIds, { selectedCardToPlant = null, selected = [] } = {}) {
    const els = makeEls(handIds);
    global.document = { getElementById: (id) => els[id] || null };
    const hand = {};
    handIds.forEach(id => { hand[id] = { id }; });
    const ctx = {
        selectedCardToPlant,
        selectedPaymentCards: [...selected],
        cleanupUI() {},
        game: { gamedatas: { hand } },
    };
    ctx.markSelectableCard = new Function('el', 'state', extractMethod('markSelectableCard')).bind(ctx);
    ctx.highlightHandCardsForCost = new Function('cost', 'onChange', extractMethod('highlightHandCardsForCost')).bind(ctx);
    return { ctx, els };
}

// Re-run highlight after each change so onclick closures reflect the latest
// selected/unselected state — this is what the real caller does via
// onChange -> updateStatusBar -> highlightHandCardsForCost.
function click(ctx, els, cost, id) {
    els[`card_${id}`].onclick();
    ctx.highlightHandCardsForCost(cost, () => {});
}

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ok  — ${name}`); passed++; }
    catch (e) { console.error(`  FAIL — ${name}\n    ${e.message}`); failed++; }
}

t('clicking an unselected card selects it', () => {
    const { ctx, els } = buildCtx([1, 2, 3]);
    ctx.highlightHandCardsForCost(2, () => {});
    click(ctx, els, 2, 1);
    assert.deepEqual(ctx.selectedPaymentCards, [1]);
});

t('clicking a SELECTED card deselects it (the actual bug)', () => {
    const { ctx, els } = buildCtx([1, 2, 3]);
    ctx.highlightHandCardsForCost(2, () => {});
    click(ctx, els, 2, 1);   // select 1
    click(ctx, els, 2, 2);   // select 2
    assert.deepEqual(ctx.selectedPaymentCards, [1, 2]);
    click(ctx, els, 2, 1);   // deselect 1
    assert.deepEqual(ctx.selectedPaymentCards, [2]);
});

t('cannot select more than `cost` cards (cap holds; deselect first)', () => {
    const { ctx, els } = buildCtx([1, 2, 3], { selected: [1, 2] }); // already at cost 2
    ctx.highlightHandCardsForCost(2, () => {});
    click(ctx, els, 2, 3);   // at cap → no-op
    assert.deepEqual(ctx.selectedPaymentCards, [1, 2]);
    click(ctx, els, 2, 1);   // deselect one
    click(ctx, els, 2, 3);   // now there's room
    assert.deepEqual(ctx.selectedPaymentCards, [2, 3]);
});

t('the card being planted is never selectable as its own payment', () => {
    const { ctx, els } = buildCtx([1, 2, 3], { selectedCardToPlant: 2 });
    ctx.highlightHandCardsForCost(2, () => {});
    assert.equal(els['card_2'].onclick, null, 'the plant card should have no click handler');
    assert.ok(els['card_1'].onclick, 'other cards should be clickable');
});

// Trello InZoBHJY + wSNYx34l + 5PPWbV5J: the standardized scheme is a crisp
// zero-blur box-shadow RING (not a CSS border, so it never resizes the card):
// thick blue for the card being planted, thick orange when selected, plain
// green when available. No real border is set (that would shrink the face).
t('standardized rings: plant card thick blue, selected-cost thick orange, available-cost thin green', () => {
    const { ctx, els } = buildCtx([1, 2, 3], { selectedCardToPlant: 2, selected: [1] });
    ctx.highlightHandCardsForCost(2, () => {});
    assert.match(els['card_2'].style.boxShadow, /0 0 0 4px .*#3498db/i, 'plant card should be a thick blue ring');
    assert.match(els['card_1'].style.boxShadow, /0 0 0 4px .*#f1c40f/i, 'selected cost card should be a thick orange ring');
    assert.match(els['card_3'].style.boxShadow, /0 0 0 2px .*#2ecc71/i, 'available cost card should be a thin green ring');
    // No CSS border is applied — a real border would eat into the fixed
    // border-box and shrink the card face (Trello 5PPWbV5J).
    assert.equal(els['card_1'].style.border, '', 'no layout border on selected card');
    assert.equal(els['card_2'].style.border, '', 'no layout border on plant card');
    assert.equal(els['card_3'].style.border, '', 'no layout border on available card');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
