/**
 * Standalone Node test for the player-panel data helpers in Game.js:
 *   - computePlayerStats(playerId) → { handCount, bonusWeather:{sun,rain,wind} }
 *   - treevolvedCards(playerId)    → this player's Adult/Treevolved plants
 *
 * History: computePlayerStats used to also return a per-family/per-level
 * plant breakdown (s.plants.cactus.baby = [..]) that fed the old plant-
 * counts table. That table was replaced by the treevolved icon subpanel
 * (Trello ozx98mdL → aPeeyKyv), and the per-family/dual-source counting
 * moved into treevolvedCards(). This test now covers both helpers in their
 * current shape.
 *
 * Why standalone: BGA Studio ships no JS test runner and Game.js depends on
 * the framework `bga` object. We pull the real method bodies out of Game.js
 * (so this exercises production code, not a re-implementation) and stub the
 * minimum surface.
 *
 * Run: node tests/computePlayerStats.test.mjs
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

function buildGame(gamedatas, currentPlayerId) {
    const game = {
        gamedatas,
        bga: { players: { getCurrentPlayerId: () => currentPlayerId } },
    };
    game.isAdult = new Function('plantType', `${extractMethod('isAdult')}`);
    game.computePlayerStats = new Function('playerId', `${extractMethod('computePlayerStats')}\n;`).bind(game);
    game.treevolvedCards = new Function('playerId', `${extractMethod('treevolvedCards')}\n;`).bind(game);
    return game;
}

// ────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────
const PLANT_CARD_TYPES = {
    'Cattus':    { plant_type: 'baby_cactus' },
    'Battus':    { plant_type: 'trv_cactus'  },
    'Buttercup': { plant_type: 'baby_flower' },
    'Arrowhead': { plant_type: 'trv_flower'  },
    'Gum Tree':  { plant_type: 'baby_tree'   },
    'Geometree': { plant_type: 'trv_tree'    },
};

function fixture() {
    return {
        // Player 1 (100): 2 Baby Cactus on planters (lv0, lv2), 1 Adult Cactus
        // on a planter (lv1), 1 Adult Cactus maxed at lv3 (plantsLevel3), and
        // 1 Baby Tree on a planter (lv0). 5 hand cards. Player 2 (200): nothing
        // planted, 3 hand cards.
        plantCardTypes: PLANT_CARD_TYPES,
        handCounts: { 100: 5, 200: 3 },
        planters: {
            10: { id: 10, location: 'garden', location_arg: 100 },
            11: { id: 11, location: 'garden', location_arg: 100 },
            12: { id: 12, location: 'garden', location_arg: 100 },
            13: { id: 13, location: 'garden', location_arg: 100 },
            20: { id: 20, location: 'garden', location_arg: 200 },
        },
        plantsOnPlanters: {
            1001: { id: 1001, type: 'Cattus',   type_arg: 0, location: 'planter', location_arg: 10 },
            1002: { id: 1002, type: 'Cattus',   type_arg: 2, location: 'planter', location_arg: 11 },
            1003: { id: 1003, type: 'Battus',   type_arg: 1, location: 'planter', location_arg: 12 }, // Adult, still on planter
            1004: { id: 1004, type: 'Gum Tree', type_arg: 0, location: 'planter', location_arg: 13 },
        },
        plantsLevel3: {
            1005: { id: 1005, type: 'Battus', type_arg: 3, location: 'garden_level3', location_arg: 100 }, // Adult, maxed
        },
        weatherPublicBonus: {
            // p1 holds 2 sun, 1 rain. p2 holds 1 wind.
            9001: { id: 9001, type: 'bonus', type_arg: 0, location: 'weather_public_bonus', location_arg: 100 },
            9002: { id: 9002, type: 'bonus', type_arg: 0, location: 'weather_public_bonus', location_arg: 100 },
            9003: { id: 9003, type: 'bonus', type_arg: 1, location: 'weather_public_bonus', location_arg: 100 },
            9004: { id: 9004, type: 'bonus', type_arg: 2, location: 'weather_public_bonus', location_arg: 200 },
        },
        // Played-this-round cards must NOT count toward held bonus.
        weatherPlayedBonus: {
            9100: { id: 9100, type: 'bonus', type_arg: 0, location: 'weather_played_bonus', location_arg: 100 },
        },
    };
}

// ────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ok  — ${name}`); passed++; }
    catch (e) { console.error(`  FAIL — ${name}\n    ${e.message}`); failed++; }
}

// ── computePlayerStats: hand count + held bonus weather ──
t('computePlayerStats: hand count', () => {
    const game = buildGame(fixture(), 100);
    assert.equal(game.computePlayerStats(100).handCount, 5);
    assert.equal(game.computePlayerStats(200).handCount, 3);
});

t('computePlayerStats: held bonus weather counts, excluding played-this-round', () => {
    const s = buildGame(fixture(), 100).computePlayerStats(100);
    assert.equal(s.bonusWeather.sun,  2); // the played-this-round sun is NOT counted
    assert.equal(s.bonusWeather.rain, 1);
    assert.equal(s.bonusWeather.wind, 0);
});

t('computePlayerStats: an opponent\'s held bonus weather is visible', () => {
    const s = buildGame(fixture(), 100).computePlayerStats(200); // current player = p1, looking at p2
    assert.equal(s.handCount, 3);
    assert.deepEqual(s.bonusWeather, { sun: 0, rain: 0, wind: 1 });
});

t('computePlayerStats: empty gamedatas → zeros, no throw', () => {
    const s = buildGame({ plantCardTypes: PLANT_CARD_TYPES }, 100).computePlayerStats(100);
    assert.equal(s.handCount, 0);
    assert.deepEqual(s.bonusWeather, { sun: 0, rain: 0, wind: 0 });
});

// ── treevolvedCards: Adult/Treevolved plants at ANY level, dual-source ──
t('treevolvedCards: collects Adult plants from BOTH planters (lv0-2) and plantsLevel3 (maxed)', () => {
    const cards = buildGame(fixture(), 100).treevolvedCards(100);
    // The lv1 Battus still on a planter AND the maxed lv3 Battus — but NOT
    // the Baby Cactus / Baby Tree. Sorted by id.
    assert.deepEqual(cards.map(c => c.id), [1003, 1005]);
});

t('treevolvedCards: none for a player with no adult plants', () => {
    assert.deepEqual(buildGame(fixture(), 100).treevolvedCards(200), []);
});

t('treevolvedCards: an Adult on another player\'s planter counts for THAT player, not this one', () => {
    const data = fixture();
    data.plantsOnPlanters[1003].location_arg = 20; // move the lv1 Adult Cactus onto p2's planter
    const game = buildGame(data, 100);
    assert.deepEqual(game.treevolvedCards(100).map(c => c.id), [1005]);       // p1 keeps only the maxed one
    assert.deepEqual(game.treevolvedCards(200).map(c => c.id), [1003]);       // p2 now shows the moved one
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
