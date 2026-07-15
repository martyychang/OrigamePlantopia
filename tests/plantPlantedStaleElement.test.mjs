/**
 * Regression test for https://trello.com/c/wVzDccUu
 * "When Battus is planted with Cutetus chosen as the baby plant to
 * sacrifice, Cutetus is rendered behind Battus"
 *
 * Root cause: planting a Treevolved card pays by sacrificing an existing
 * garden plant (not a hand card). The server already discards the
 * sacrificed plant (PlantingPhase::actPlant), but notif_plantPlanted only
 * ever cleaned up HAND entries for payment_card_ids — never the sacrificed
 * plant's DOM element or its gamedatas.plantsOnPlanters/plantsLevel3
 * entry. renderPlantInPlanter only ever APPENDS into the planter slot, so
 * the new adult card landed on top of the still-present old card instead
 * of replacing it.
 *
 * This needs a real DOM (document.getElementById/remove), which this
 * project's other JS tests don't need — driven via headless Chrome rather
 * than plain Node, same technique used to verify the player-panel icon
 * CSS sprite work. Extracts the REAL notif_plantPlanted method body out of
 * Game.js (same extraction approach as computePlayerStats.test.mjs) so
 * this exercises production code, not a re-implementation.
 *
 * Run: node tests/plantPlantedStaleElement.test.mjs
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

const methodBody = extractMethod('notif_plantPlanted');

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<div id="player-tables">
    <div id="planter-slot_5001">
        <!-- Stale Cutetus element left behind after being sacrificed to treevolve into Battus. -->
        <div id="garden_plant_9001" class="stale-cutetus">Cutetus (STALE)</div>
    </div>
</div>
<div id="results"></div>
<script>
function log(line) { document.getElementById('results').innerHTML += line + '<br>'; }

const game = {
    gamedatas: {
        hand: {},
        plantsOnPlanters: {
            9001: { id: 9001, type: 'Cutetus', type_arg: 0, location: 'planter', location_arg: 5001 },
        },
        plantsLevel3: {},
        plantCardTypes: { Battus: { plant_type: 'trv_cactus' } },
        handCounts: { 7: 5 },
        players: { 7: {} },
    },
    bga: {
        players: { getCurrentPlayerId: () => 7 },
        states: { getCurrentMainStateName: () => 'WeatherPhaseStart' },
    },
    isBabyType: (t) => ['baby_cactus', 'baby_flower', 'baby_tree'].includes(t),
    renderHand: () => {},
    refreshAllPlayerPanels: () => {},
    // Minimal stand-in for the real renderer — appends the new card with
    // the same id convention the real code uses (garden_plant_<id>),
    // which is all this test needs to confirm the slot ends up with
    // exactly one (correct) child. Unrelated to the fix under test.
    renderPlantInPlanter: function (card, planterId) {
        const slot = document.getElementById(\`planter-slot_\${planterId}\`);
        slot.insertAdjacentHTML('beforeend', \`<div id="garden_plant_\${card.id}" class="new-battus">\${card.type}</div>\`);
    },
};

const notif_plantPlanted = new Function("args", ${JSON.stringify(methodBody)}).bind(game);

const args = {
    player_id: 7,
    card: { id: 9002, type: 'Battus', type_arg: 0, location: 'planter', location_arg: 5001 },
    planter_id: 5001,
    payment_card_ids: [9001],
};
notif_plantPlanted(args);

const slot = document.getElementById('planter-slot_5001');
const children = Array.from(slot.children).map(el => el.id);

const checks = [
    ['stale Cutetus DOM element (garden_plant_9001) was removed', !document.getElementById('garden_plant_9001')],
    ['new Battus DOM element (garden_plant_9002) is present', !!document.getElementById('garden_plant_9002')],
    ['planter slot has exactly ONE child element (not two stacked)', children.length === 1],
    ['the one child is the new Battus, not the old Cutetus', children[0] === 'garden_plant_9002'],
    ['sacrificed Cutetus removed from gamedatas.plantsOnPlanters', !game.gamedatas.plantsOnPlanters[9001]],
    ['new Battus added to gamedatas.plantsOnPlanters', !!game.gamedatas.plantsOnPlanters[9002]],
];
checks.forEach(([label, cond]) => log((cond ? 'ok' : 'FAIL') + ' — ' + label));
</script>
</body></html>
`;

const dir = mkdtempSync(path.join(tmpdir(), 'plantopia-battus-test-'));
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
