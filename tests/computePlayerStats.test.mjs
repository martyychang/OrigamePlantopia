/**
 * Standalone Node test for the Game.computePlayerStats helper.
 *
 * Why standalone: BGA Studio doesn't ship a JS test runner and the
 * production Game.js depends on the framework's `bga` object. This test
 * stubs the minimum surface (`this.bga.players.getCurrentPlayerId`, the
 * isAdult/isBabyType helpers) and calls computePlayerStats with hand-
 * built gamedatas so we can assert the math.
 *
 * Run: node tests/computePlayerStats.test.mjs
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// Pull the helper bodies out of the real Game.js so the test exercises
// the production code, not a re-implementation. The two helpers we need
// are pure-ish: they only touch `this.gamedatas`, `this.bga.players`,
// `this.isAdult`, `this.isBabyType`. Stub each.
const src = readFileSync(new URL('../origameplantopia/modules/js/Game.js', import.meta.url), 'utf8');
function extractMethod(name) {
    // Match `<name>(args) {  body  }` at indentation 4, terminated by a
    // line containing only `    }`. Works because all Game methods use
    // 4-space indentation.
    const re = new RegExp(`\\n    ${name}\\([^)]*\\)\\s*\\{\\n([\\s\\S]*?)\\n    \\}`, 'm');
    const m = src.match(re);
    if (!m) throw new Error(`extractMethod failed for ${name}`);
    return m[1];
}

const computePlayerStats = new Function('playerId',
    `const r = (() => { ${extractMethod('computePlayerStats')} })();
     // The IIFE above doesn't return — re-run with a real this. Fall back
     // to direct eval below.`);

// Simpler: just stuff the methods onto an object via Function.bind.
function buildGame(gamedatas, currentPlayerId) {
    const game = {
        gamedatas,
        bga: { players: { getCurrentPlayerId: () => currentPlayerId } },
        isAdult(t)    { return ['trv_cactus','trv_flower','trv_tree'].includes(t); },
        isBabyType(t) { return ['baby_cactus','baby_flower','baby_tree'].includes(t); },
    };
    // Compile the live method bodies into bound methods on `game`.
    game.computePlayerStats = new Function('playerId',
        `${extractMethod('computePlayerStats')}\n;`
    ).bind(game);
    return game;
}

// ────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────
const PLANT_CARD_TYPES = {
    'Cattus':              { plant_type: 'baby_cactus' },
    'Battus':              { plant_type: 'trv_cactus'  },
    'Buttercup':           { plant_type: 'baby_flower' },
    'Arrowhead':           { plant_type: 'trv_flower'  },
    'Gum Tree':            { plant_type: 'baby_tree'   },
    'Geometree':           { plant_type: 'trv_tree'    },
};

function fixture() {
    return {
        // Player 1 has: 2 Baby Cactus on planters (lv 0 and lv 2), 1 Adult
        // Cactus on planter (lv 1), 1 Adult Cactus at lv3 (in garden_level3),
        // 1 Baby Tree on planter (lv 0). And 5 hand cards.
        // Player 2 has nothing yet but 3 hand cards.
        plantCardTypes: PLANT_CARD_TYPES,
        handCounts: { 100: 5, 200: 3 },
        planters: {
            10: { id: 10, location: 'garden', location_arg: 100 }, // p1
            11: { id: 11, location: 'garden', location_arg: 100 }, // p1
            12: { id: 12, location: 'garden', location_arg: 100 }, // p1
            13: { id: 13, location: 'garden', location_arg: 100 }, // p1
            20: { id: 20, location: 'garden', location_arg: 200 }, // p2
        },
        plantsOnPlanters: {
            // p1 planter 10: Baby Cactus level 0
            1001: { id: 1001, type: 'Cattus',    type_arg: 0, location: 'planter', location_arg: 10 },
            // p1 planter 11: Baby Cactus level 2
            1002: { id: 1002, type: 'Cattus',    type_arg: 2, location: 'planter', location_arg: 11 },
            // p1 planter 12: Adult Cactus level 1
            1003: { id: 1003, type: 'Battus',    type_arg: 1, location: 'planter', location_arg: 12 },
            // p1 planter 13: Baby Tree level 0
            1004: { id: 1004, type: 'Gum Tree',  type_arg: 0, location: 'planter', location_arg: 13 },
        },
        plantsLevel3: {
            // p1 Adult Cactus at level 3 (max)
            1005: { id: 1005, type: 'Battus', type_arg: 3, location: 'garden_level3', location_arg: 100 },
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
// Cases
// ────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ok  — ${name}`); passed++; }
    catch (e) { console.error(`  FAIL — ${name}\n    ${e.message}`); failed++; }
}

t('Player 1: counts every plant by family/maturity/level', () => {
    const game = buildGame(fixture(), 100);
    const s = game.computePlayerStats(100);
    assert.equal(s.handCount, 5);
    // Baby cactus: 1 at level 0, 0 at level 1, 1 at level 2, 0 at level 3
    assert.deepEqual(s.plants.cactus.baby, [1, 0, 1, 0]);
    // Adult cactus: 0,1,0,1 (one Battus at lv 1 on planter, one at lv 3 in garden_level3)
    assert.deepEqual(s.plants.cactus.adult, [0, 1, 0, 1]);
    // Baby tree: 1 at level 0
    assert.deepEqual(s.plants.tree.baby,   [1, 0, 0, 0]);
    // Adult tree: empty
    assert.deepEqual(s.plants.tree.adult,  [0, 0, 0, 0]);
});

t('Player 1: held bonus weather counts (excludes played)', () => {
    const game = buildGame(fixture(), 100);
    const s = game.computePlayerStats(100);
    // Held: 2 sun + 1 rain. Played-this-round (1 sun) must NOT be counted.
    assert.equal(s.bonusWeather.sun,  2);
    assert.equal(s.bonusWeather.rain, 1);
    assert.equal(s.bonusWeather.wind, 0);
});

t('Player 2: held bonus weather visible from opponent perspective', () => {
    const game = buildGame(fixture(), 100); // current player = p1
    const s = game.computePlayerStats(200);
    assert.equal(s.handCount, 3);
    assert.equal(s.bonusWeather.wind, 1);
    assert.equal(s.bonusWeather.sun, 0);
    // p2 has no plants
    assert.deepEqual(s.plants.cactus.baby, [0, 0, 0, 0]);
});

t('Missing collections: empty gamedatas → all zeros', () => {
    const game = buildGame({ plantCardTypes: PLANT_CARD_TYPES }, 100);
    const s = game.computePlayerStats(100);
    assert.equal(s.handCount, 0);
    assert.deepEqual(s.plants.cactus.baby,  [0,0,0,0]);
    assert.deepEqual(s.plants.flower.adult, [0,0,0,0]);
    assert.deepEqual(s.bonusWeather, { sun: 0, rain: 0, wind: 0 });
});

t('Plant on a planter owned by another player is not counted', () => {
    const data = fixture();
    // Move a Cattus onto p2's planter — p1's count for it must go to 0.
    data.plantsOnPlanters[1001].location_arg = 20; // planter 20 owned by p2
    const game = buildGame(data, 100);
    const sP1 = game.computePlayerStats(100);
    assert.equal(sP1.plants.cactus.baby[0], 0); // moved away
    const sP2 = game.computePlayerStats(200);
    assert.equal(sP2.plants.cactus.baby[0], 1); // showed up here
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
