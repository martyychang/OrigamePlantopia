/**
 * Regression test for https://trello.com/c/UlEhJIr5
 * "Level number annotation on cards do not change from level 0 to level 0
 * or from level 1 to level 2"
 *
 * The earlier fix for https://trello.com/c/7CO2tan1 (see
 * level3PlantGrowth.test.mjs) regenerated the in-card "Level: N" text badge
 * — but ONLY inside notif_plantGrown's `if (args.max_level)` branch, i.e.
 * only for the final transition where a plant graduates off its planter
 * and becomes a tilted level-3 tile. Every INTERMEDIATE growth step (0→1,
 * 1→2) — where the plant stays on its planter — only had its `data-level`
 * CSS attribute updated (driving the sliding-reveal animation), never the
 * text baked into the element's innerHTML at planting time. So a plant
 * that grew from level 0 to level 1, or level 1 to level 2, kept showing
 * "Level: 0" until something forced a full server resync (reload) —
 * exactly matching Marty's report that tilted level-3 cards showed the
 * right number while everything else stayed frozen at "Level: 0".
 *
 * This drives the REAL notif_plantGrown method (not a re-implementation)
 * through headless Chrome, simulating a Pepper Tree growing 0→1 while
 * still on its planter, and confirms the badge updates.
 *
 * Run: node tests/intermediatePlantGrowthBadge.test.mjs
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

const notifPlantGrownBody = extractMethod('notif_plantGrown');
const plantCardBodyBody = extractMethod('plantCardBody');
const isAdultBody = extractMethod('isAdult');
const isBabyTypeBody = extractMethod('isBabyType');
const getFamilyBody = extractMethod('getFamily');

const script = `
window.onerror = (msg, src, line, col, err) => {
    document.getElementById('results').innerHTML += 'FAIL — uncaught error: ' + msg + ' (line ' + line + ':' + col + ')' + (err && err.stack ? '<br>' + String(err.stack).replace(/\\n/g, ' | ') : '') + '<br>';
};

const game = {
    gamedatas: {
        // A Pepper Tree on planter 5002, at level 0, about to grow to
        // level 1 — still on the planter afterward (max_level: false).
        plantsOnPlanters: {
            701: { id: 701, type: 'PepperTree', type_arg: 0, location: 'planter', location_arg: 5002 },
        },
        plantsLevel3: {},
        planters: { 5002: { id: 5002, location_arg: 9 } },
        plantCardTypes: {
            PepperTree: { name: 'Pepper Tree', cost: 1, plant_type: 'baby_tree' },
        },
        handCounts: {},
        weatherPublicBonus: {},
    },
    bga: { players: { getCurrentPlayerId: () => 9 }, states: { getCurrentMainStateName: () => 'WeatherPhaseBonus' } },
    plantingPhase: {},
    refreshAllPlayerPanels: () => {},
    isAdult: new Function('plantType', ${JSON.stringify(isAdultBody)}),
    isBabyType: new Function('plantType', ${JSON.stringify(isBabyTypeBody)}),
    getFamily: new Function('plantType', ${JSON.stringify(getFamilyBody)}),
    plantCardBody: new Function('cardKey', 'cardInfo', '{ showCost = false, levelLabel = null } = {}', ${JSON.stringify(plantCardBodyBody)}),
};
game.notif_plantGrown = new Function('args', ${JSON.stringify(notifPlantGrownBody)}).bind(game);

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function check(label, cond, detail) {
    const line = (cond ? 'ok' : 'FAIL') + ' — ' + label + (detail !== undefined ? ' (' + escapeHtml(JSON.stringify(detail)) + ')' : '');
    document.getElementById('results').innerHTML += line + '<br>';
}

// The real DOM element as it would exist mid-game: rendered by
// renderPlantInPlanter at planting time, still showing "Level: 0" and
// data-level="0", sitting inside its planter slot.
document.getElementById('planter-slot_5002').insertAdjacentHTML('beforeend', \`
    <div id="garden_plant_701" class="plantopia-plant-on-planter plantopia-card-size plantopia-baby-card" data-card-type="PepperTree" data-id="701" data-level="0">
        <div class="plant-level-indicator">Level: 0</div>
    </div>
\`);

// Grow 0 -> 1, still on the planter (max_level: false/absent).
game.notif_plantGrown({ card_id: 701, level: 1, max_level: false, player_id: 9 });

const el = document.getElementById('garden_plant_701');
check('card element stays on the planter (not moved to a tilted row)',
    el && el.parentElement && el.parentElement.id === 'planter-slot_5002');
check('data-level attribute updates to 1 (drives the sliding-reveal animation)',
    el && el.getAttribute('data-level') === '1', el ? el.getAttribute('data-level') : null);
check('in-card annotation now reads "Level: 1", not the stale "Level: 0"',
    el && el.innerHTML.includes('Level: 1') && !el.innerHTML.includes('Level: 0'),
    el ? el.innerHTML : null);

// Grow again, 1 -> 2, still on the planter — the OTHER symptom Marty
// reported ("from level 1 to level 2").
game.gamedatas.plantsOnPlanters[701].type_arg = 1;
game.notif_plantGrown({ card_id: 701, level: 2, max_level: false, player_id: 9 });
check('in-card annotation now reads "Level: 2", not stale',
    el && el.innerHTML.includes('Level: 2') && !el.innerHTML.includes('Level: 1') && !el.innerHTML.includes('Level: 0'),
    el ? el.innerHTML : null);
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<div id="planter-slot_5002"></div>
<div id="player-garden-tilted-9"></div>
<div id="results"></div>
<script>${script}</script>
</body></html>
`;

const dir = mkdtempSync(path.join(tmpdir(), 'plantopia-intermediate-growth-test-'));
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
