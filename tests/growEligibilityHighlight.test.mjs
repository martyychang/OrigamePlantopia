/**
 * Regression test for https://trello.com/c/jnO2GRJA
 * "Only eligible cards should have green highlight when processing Carrot ability"
 *
 * Carrot's ability queues a level_up with target 'baby_plant' (grow a Baby Plant
 * by 1). The client highlighted EVERY non-maxed plant in the garden, so adult
 * plants lit up too even though the server rejects them. highlightPlantsToGrow
 * now takes an isEligible(pl) predicate; the level_up handler builds it from the
 * effect's target (baby_plant → Baby only, other_plant → exclude the source,
 * any_plant → all), mirroring the server's playerHasLevelUpTarget.
 *
 * Drives the REAL highlightPlantsToGrow + isBaby extracted from Game.js against
 * fake gamedatas + a document stub; asserts only eligible plants get wired up.
 *
 * Run: node tests/growEligibilityHighlight.test.mjs
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../plantopia/modules/js/Game.js', import.meta.url), 'utf8');
function extractMethod(name) {
    const at = src.indexOf(`\n    ${name}(`);
    if (at === -1) throw new Error(`extractMethod failed for ${name}`);
    const braceOpen = src.indexOf('{', at); // first { after the signature is the body
    if (braceOpen === -1) throw new Error(`no body brace for ${name}`);
    let i = braceOpen + 1, depth = 1;
    const start = i;
    for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break; } }
    return src.slice(start, i);
}

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ok  — ${name}`); passed++; }
    catch (e) { console.error(`  FAIL — ${name}\n    ${e.message}`); failed++; }
}

// Garden: baby cactus (L1), adult cactus (L1), baby cactus maxed (L3), all on
// the player's own planters.
function buildCtx() {
    const plantsOnPlanters = {
        1: { id: 1, type: 'Cattus',  type_arg: 1, location_arg: 5001 }, // baby, growable
        2: { id: 2, type: 'Dogtus',  type_arg: 1, location_arg: 5002 }, // ADULT, growable
        3: { id: 3, type: 'Cutetus', type_arg: 3, location_arg: 5003 }, // baby, MAXED
    };
    const planters = { 5001: { location_arg: 7 }, 5002: { location_arg: 7 }, 5003: { location_arg: 7 } };
    const plantCardTypes = {
        Cattus:  { plant_type: 'baby_cactus' },
        Dogtus:  { plant_type: 'trv_cactus' },
        Cutetus: { plant_type: 'baby_cactus' },
    };
    const els = {};
    for (const id of [1, 2, 3]) els[`garden_plant_${id}`] = { classList: { add() {}, remove() {} }, style: {}, onclick: null };
    global.document = { getElementById: (id) => els[id] || null, querySelectorAll: () => [] };
    const ctx = {
        game: { gamedatas: { plantsOnPlanters, planters, plantCardTypes } },
        bga: { players: { getCurrentPlayerId: () => 7 } },
        cleanupUI() {},
        markSelectableCard(el) { if (el) el.classList.add('bga-cards_selectable-card'); },
    };
    ctx.isBaby = new Function('plantType', extractMethod('isBaby')).bind(ctx);
    ctx.highlightPlantsToGrow = new Function('callback', 'isEligible', extractMethod('highlightPlantsToGrow')).bind(ctx);
    return { ctx, els };
}

const babyPredicate = (ctx) => (pl) => {
    const info = ctx.game.gamedatas.plantCardTypes[pl.type];
    return !!info && ctx.isBaby(info.plant_type);
};

t('Carrot (baby target): only the growable Baby plant is highlighted', () => {
    const { ctx, els } = buildCtx();
    ctx.highlightPlantsToGrow(() => {}, babyPredicate(ctx));
    assert.ok(els['garden_plant_1'].onclick, 'baby (L1) should be selectable');
    assert.equal(els['garden_plant_2'].onclick, null, 'adult should NOT be selectable for a baby target');
    assert.equal(els['garden_plant_3'].onclick, null, 'maxed baby (L3) should NOT be selectable');
});

t('any target: every non-maxed plant is highlighted, maxed excluded', () => {
    const { ctx, els } = buildCtx();
    // (the real signature defaults isEligible to () => true — passed explicitly
    // here since extractMethod pulls only the body, not the param default)
    ctx.highlightPlantsToGrow(() => {}, () => true);
    assert.ok(els['garden_plant_1'].onclick, 'baby L1 selectable');
    assert.ok(els['garden_plant_2'].onclick, 'adult L1 selectable (any target)');
    assert.equal(els['garden_plant_3'].onclick, null, 'maxed L3 excluded');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
