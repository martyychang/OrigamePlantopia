/**
 * Regression test for https://trello.com/c/7CO2tan1
 * "Level 3 Cattus cannot be sacrificed to plant Bufftus"
 *
 * Three symptoms, one root cause. When a plant reaches level 3,
 * notif_plantGrown moves it client-side from gamedatas.plantsOnPlanters to
 * gamedatas.plantsLevel3 by re-keying the SAME object — but never
 * translated its `location_arg` field, which means something different in
 * each collection:
 *   - plantsOnPlanters: location_arg = the PLANTER's card id (owner
 *     resolved indirectly via gamedatas.planters[locationArg].location_arg)
 *   - plantsLevel3: location_arg = the PLAYER's id directly, matching the
 *     server's own convention (moveCard($cardId, 'garden_level3',
 *     $playerId) in PlantingPhase.php/WeatherPhaseGrow.php)
 * Left untranslated, the plant's location_arg stayed at the stale planter
 * id after graduating — so every "does this belong to me" check
 * downstream compared a planter id against a player id and silently
 * excluded it:
 *   1. computePlayerStats' level-3 count for that family/maturity stayed
 *      at 0 (the player panel showed the plant as never having existed).
 *   2. highlightGardenPlantsForCost (PlantingPhase's Treevolve-sacrifice
 *      selection) never highlighted it as selectable.
 * Separately, the "Level: N" text badge baked into the card's DOM element
 * at PLANTING time (level 0) was never regenerated when the card
 * graduated — only the data-level attribute (which drives the on-planter
 * sliding-reveal animation, irrelevant once off the planter) was updated —
 * so the tilted card visually showed "Level: 0" forever.
 *   3. The in-card annotation showed "Level: 0" instead of "Level: 3".
 *
 * This drives the REAL notif_plantGrown, computePlayerStats, and
 * PlantingPhase.highlightGardenPlantsForCost methods (not
 * re-implementations) through headless Chrome, simulating a Baby Cactus
 * (Cattus) growing from level 2 to level 3 on a planter, then confirms all
 * three symptoms are fixed.
 *
 * Run: node tests/level3PlantGrowth.test.mjs
 * Requires: Google Chrome at the path below (macOS default location).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const src = readFileSync(new URL('../plantopia/modules/js/Game.js', import.meta.url), 'utf8');

function extractMethod(name) {
    const re = new RegExp(`\\n    (?:async )?${name}\\([^)]*\\)\\s*\\{\\n([\\s\\S]*?)\\n    \\}\\n`, 'm');
    const m = src.match(re);
    if (!m) throw new Error(`extractMethod failed for ${name}`);
    return m[1];
}

function extractClass(name) {
    const startMarker = `class ${name} {`;
    const startIdx = src.indexOf(startMarker);
    if (startIdx === -1) throw new Error(`extractClass: ${name} not found`);
    let depth = 0;
    let i = startIdx;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) { i++; break; }
        }
    }
    return src.slice(startIdx, i);
}

const notifPlantGrownBody = extractMethod('notif_plantGrown');
const computePlayerStatsBody = extractMethod('computePlayerStats');
const plantCardBodyBody = extractMethod('plantCardBody');
const isAdultBody = extractMethod('isAdult');
const isBabyTypeBody = extractMethod('isBabyType');
const getFamilyBody = extractMethod('getFamily');
const plantingPhaseClassSrc = extractClass('PlantingPhase');

const script = `
function _(s) { return s; }
window.onerror = (msg, src, line, col, err) => {
    document.getElementById('results').innerHTML += 'FAIL — uncaught error: ' + msg + ' (line ' + line + ':' + col + ')' + (err && err.stack ? '<br>' + String(err.stack).replace(/\\n/g, ' | ') : '') + '<br>';
};

// A single game object plays the role of "this" inside both the Game-class
// notif_plantGrown/computePlayerStats methods AND (via .game) what
// PlantingPhase reads. Matches how these are really wired: Game owns
// gamedatas, PlantingPhase holds a reference to the Game instance.
const game = {
    gamedatas: {
        // A Baby Cactus (Cattus) on planter 5001, already at level 2,
        // about to grow to level 3 (graduate off the planter).
        plantsOnPlanters: {
            501: { id: 501, type: 'Cattus', type_arg: 2, location: 'planter', location_arg: 5001 },
        },
        plantsLevel3: {},
        planters: { 5001: { id: 5001, location_arg: 7 } },
        plantCardTypes: {
            Cattus: { name: 'Cattus', cost: 1, plant_type: 'baby_cactus' },
            Bufftus: { name: 'Bufftus', cost: 1, cost_unit: 'baby_cactus', plant_type: 'trv_cactus' },
        },
        handCounts: {},
        weatherPublicBonus: {},
    },
    // getCurrentMainStateName deliberately returns something other than
    // 'PlantingPhase' — notif_plantGrown's own re-render trigger for the
    // acting player's client isn't what this test is about (see
    // plantingPhaseIsCurrentPlayerActive.test.mjs for that), just needs to
    // not throw. plantingPhase only needs to tolerate justActed being set.
    bga: { players: { getCurrentPlayerId: () => 7 }, states: { getCurrentMainStateName: () => 'WeatherPhaseBonus' } },
    plantingPhase: {},
    refreshAllPlayerPanels: () => {},
    isAdult: new Function('plantType', ${JSON.stringify(isAdultBody)}),
    isBabyType: new Function('plantType', ${JSON.stringify(isBabyTypeBody)}),
    getFamily: new Function('plantType', ${JSON.stringify(getFamilyBody)}),
    plantCardBody: new Function('cardKey', 'cardInfo', '{ showCost = false, levelLabel = null } = {}', ${JSON.stringify(plantCardBodyBody)}),
};
game.notif_plantGrown = new Function('args', ${JSON.stringify(notifPlantGrownBody)}).bind(game);
game.computePlayerStats = new Function('playerId', ${JSON.stringify(computePlayerStatsBody)}).bind(game);

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function check(label, cond, detail) {
    // detail can itself contain HTML markup (e.g. el.innerHTML) — escaping
    // it is required, not cosmetic: appending unescaped markup via
    // innerHTML += gets parsed as real elements, corrupting the #results
    // container's structure and silently truncating every check after it.
    const line = (cond ? 'ok' : 'FAIL') + ' — ' + label + (detail !== undefined ? ' (' + escapeHtml(JSON.stringify(detail)) + ')' : '');
    document.getElementById('results').innerHTML += line + '<br>';
}

// The real DOM element as it would exist mid-game: rendered by
// renderPlantInPlanter at planting time, still showing "Level: 0" (its
// state when first planted) and data-level="0", sitting inside its
// planter slot.
document.getElementById('planter-slot_5001').insertAdjacentHTML('beforeend', \`
    <div id="garden_plant_501" class="plantopia-plant-on-planter plantopia-card-size plantopia-baby-card" data-card-type="Cattus" data-id="501" data-level="0">
        <div class="plant-level-indicator">Level: 0</div>
    </div>
\`);

game.notif_plantGrown({ card_id: 501, level: 3, max_level: true, player_id: 7 });

// ── Symptom 1: in-card annotation ──
const el = document.getElementById('garden_plant_501');
check('card element moved into the tilted row', el && el.parentElement && el.parentElement.id === 'player-garden-tilted-7');
check('in-card annotation now reads "Level: 3", not the stale "Level: 0"',
    el && el.innerHTML.includes('Level: 3') && !el.innerHTML.includes('Level: 0'),
    el ? el.innerHTML : null);

// ── Symptom 2: player panel counter ──
check('gamedatas.plantsLevel3[501].location_arg is the PLAYER id (7), not the stale planter id (5001)',
    game.gamedatas.plantsLevel3[501] && game.gamedatas.plantsLevel3[501].location_arg == 7,
    game.gamedatas.plantsLevel3[501]);
const stats = game.computePlayerStats(7);
check('computePlayerStats(7) counts the level-3 Baby Cactus (index 3 = 1, not 0)',
    JSON.stringify(stats.plants.cactus.baby) === JSON.stringify([0, 0, 0, 1]),
    stats.plants.cactus.baby);

// ── Symptom 3: selectable as a Treevolve sacrifice ──
const PlantingPhase = new Function('return (' + ${JSON.stringify(plantingPhaseClassSrc)} + ');')();
const bga = { players: { getCurrentPlayerId: () => 7 } };
const pp = new PlantingPhase(game, bga);
pp.cleanupUI = () => {}; // touches DOM classes unrelated to this check; no-op is fine here

let clickedId = null;
// Bufftus (a Treevolved Cactus) costs 1 baby_cactus of level >= its own
// cost — the level-3 Cattus (type_arg 3) qualifies.
pp.highlightGardenPlantsForCost(id => { clickedId = id; }, game.gamedatas.plantCardTypes.Bufftus);

check('the level-3 Cattus tile is marked selectable (bga-cards_selectable-card)',
    el.classList.contains('bga-cards_selectable-card'));
if (el.onclick) el.onclick();
check('clicking the tile selects card 501 as the sacrifice', clickedId === 501, clickedId);
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<div id="planter-slot_5001"></div>
<div id="player-garden-tilted-7"></div>
<div id="results"></div>
<script>${script}</script>
</body></html>
`;

const dir = mkdtempSync(path.join(tmpdir(), 'plantopia-level3growth-test-'));
const htmlPath = path.join(dir, 'test.html');
writeFileSync(htmlPath, html);

let dump;
try {
    dump = execFileSync(CHROME, ['--headless', '--disable-gpu', '--dump-dom', `file://${htmlPath}`], { encoding: 'utf8' });
} finally {
    rmSync(dir, { recursive: true, force: true });
}

const resultsMatch = dump.match(/<div id="results">([\s\S]*?)<\/div>/);
if (!resultsMatch) {
    console.error('FAIL — could not find #results in the headless Chrome DOM dump; is Chrome installed at the expected path?');
    process.exit(1);
}
const lines = resultsMatch[1].split('<br>').map((s) => s.trim()).filter(Boolean);

let failures = 0;
for (const line of lines) {
    console.log('  ' + line);
    if (line.startsWith('FAIL')) failures++;
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
