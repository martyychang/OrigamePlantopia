/**
 * Standalone Node test for Game.js's hand display-order helper:
 *   - sortedHandCards(handData) → plant cards sorted by family (Tree →
 *     Flower → Cactus, per the rulebook's family order), Baby before Adult
 *     within each family, then by card name ascending (Trello uaWJEFry).
 *
 * Why standalone: BGA Studio ships no JS test runner and Game.js depends on
 * the framework `bga` object. We pull the real method body out of Game.js
 * (so this exercises production code, not a re-implementation) and stub the
 * minimum surface (gamedatas.plantCardTypes).
 *
 * Run: node tests/handSortOrder.test.mjs
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

// Real plant_type / name data for a handful of cards across all six buckets.
const PLANT_CARD_TYPES = {
    'Gum Tree':  { name: 'Gum Tree',  plant_type: 'baby_tree' },
    'Tree Tree': { name: 'Tree Tree', plant_type: 'baby_tree' },
    'Boba Tree': { name: 'Boba Tree', plant_type: 'trv_tree' },
    'Buttercup': { name: 'Buttercup', plant_type: 'baby_flower' },
    'Arrowhead': { name: 'Arrowhead', plant_type: 'trv_flower' },
    'Cutetus':   { name: 'Cutetus',   plant_type: 'baby_cactus' },
    'Captus':    { name: 'Captus',    plant_type: 'trv_cactus' },
    'Mystery':   { name: 'Mystery',   plant_type: 'unknown_type' }, // defensive
};

const game = { gamedatas: { plantCardTypes: PLANT_CARD_TYPES } };
game.sortedHandCards = new Function('handData', `${extractMethod('sortedHandCards')}\n;`).bind(game);

let failures = 0;
function check(label, cond, detail = '') {
    if (cond) { console.log(`  ok  — ${label}`); }
    else { console.log(`  FAIL — ${label}${detail ? ` (${detail})` : ''}`); failures++; }
}

// Hand deliberately out of order, keyed by card id (as getAllDatas ships it).
const hand = {
    1: { id: 1, type: 'Captus' },     // trv_cactus
    2: { id: 2, type: 'Buttercup' },  // baby_flower
    3: { id: 3, type: 'Gum Tree' },   // baby_tree
    4: { id: 4, type: 'Arrowhead' },  // trv_flower
    5: { id: 5, type: 'Tree Tree' },  // baby_tree
    6: { id: 6, type: 'Boba Tree' },  // trv_tree
    7: { id: 7, type: 'Cutetus' },    // baby_cactus
};

const order = game.sortedHandCards(hand).map(c => c.id);
// Expected: baby_tree (Gum, Tree) → trv_tree (Boba) → baby_flower (Buttercup)
//           → trv_flower (Arrowhead) → baby_cactus (Cutetus) → trv_cactus (Captus)
check('family order Tree → Flower → Cactus, Baby before Adult, name ascending within bucket',
    JSON.stringify(order) === JSON.stringify([3, 5, 6, 2, 4, 7, 1]),
    `got ${JSON.stringify(order)}`);

// Name-ascending tie-break within the same bucket (both baby_tree).
check('"Gum Tree" sorts before "Tree Tree" (name ascending)',
    order.indexOf(3) < order.indexOf(5));

// Unknown plant_type sorts last (defensive).
const withUnknown = game.sortedHandCards({ 1: { id: 1, type: 'Mystery' }, 2: { id: 2, type: 'Gum Tree' } });
check('unknown plant_type sorts last', withUnknown.map(c => c.id).join(',') === '2,1');

// Input is not mutated.
const before = Object.keys(hand).join(',');
game.sortedHandCards(hand);
check('does not mutate the input hand object', Object.keys(hand).join(',') === before);

// Null/empty hand is safe.
check('null handData → empty array', Array.isArray(game.sortedHandCards(null)) && game.sortedHandCards(null).length === 0);

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
