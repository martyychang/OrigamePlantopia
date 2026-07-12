/**
 * Regression test for https://trello.com/c/nBsWlxlT
 * "Character cards should always be rendered in the same consistent place
 * to the right of the planters"
 *
 * Root cause: the per-player garden row (#player-garden-planters-<id>) is a
 * shared append-only container for both planters and the claimed character
 * card. setup() used to call renderCharacters() BEFORE renderPlanters() for
 * that row, so a page load/reload put the character card first (left of the
 * planters). But claiming a character live during play
 * (notif_characterClaimed) does `garden.appendChild(cardEl)` AFTER planters
 * already exist in the row, putting it last (right of the planters). Same
 * end state (one claimed character, N planters), two different DOM orders
 * depending on whether the client rendered via setup() or a live
 * notification — exactly the player-1-vs-player-2 inconsistency in the
 * screenshot on the card.
 *
 * Fix: setup() now renders planters before characters, matching the live
 * notification's append order, so both paths agree: character card always
 * ends up last (rightmost) in the row.
 *
 * This drives the REAL orderedPlayers.forEach block plus the REAL
 * renderPlanters/renderCharacters methods extracted out of Game.js (same
 * technique as computePlayerStats.test.mjs / plantPlantedStaleElement),
 * through headless Chrome for a real DOM.
 *
 * Run: node tests/characterCardPlacement.test.mjs
 * Requires: Google Chrome at the path below (macOS default location).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const src = readFileSync(new URL('../origameplantopia/modules/js/Game.js', import.meta.url), 'utf8');

function extractMethod(name) {
    const re = new RegExp(`\\n    (?:async )?${name}\\([^)]*\\)\\s*\\{\\n([\\s\\S]*?)\\n    \\}\\n`, 'm');
    const m = src.match(re);
    if (!m) throw new Error(`extractMethod failed for ${name}`);
    return m[1];
}

function extractBlock(startMarker, endMarker) {
    const startIdx = src.indexOf(startMarker);
    if (startIdx === -1) throw new Error(`extractBlock: start marker not found: ${startMarker}`);
    const endIdx = src.indexOf(endMarker, startIdx);
    if (endIdx === -1) throw new Error(`extractBlock: end marker not found: ${endMarker}`);
    return src.slice(startIdx, endIdx + endMarker.length);
}

const renderPlantersBody = extractMethod('renderPlanters');
const renderCharactersBody = extractMethod('renderCharacters');
// Unique to this forEach: 8-space indent start/end, only occurs once in setup().
const perPlayerForEach = extractBlock('        orderedPlayers.forEach(player => {', '\n        });');

// Embed the extracted method bodies as JSON string literals (not raw
// template-literal interpolation) so their own backticks/${...} don't get
// evaluated by THIS file's outer `html` template literal — they're meant to
// run inside the browser via new Function(), not here in Node.
const script = `
function log(line) { document.getElementById('results').innerHTML += line + '<br>'; }

const renderPlanters = new Function("cards", "containerId", ${JSON.stringify(renderPlantersBody)});
const renderCharacters = new Function("cards", "containerId", ${JSON.stringify(renderCharactersBody)});

const game = {
    gamedatas: {
        characterCardTypes: { Mushroom: { name: 'Mushroom', ability: '' } },
        plantCardTypes: {},
    },
    bga: {
        playerPanels: {
            getElement: () => document.createElement('div'),
        },
    },
    renderPlayerPanel: () => {},
    addPlantTooltip: () => {},
    addCharacterTooltip: () => {},
    plantCardBody: () => ({ extraClass: '', dataAttr: '', inner: '' }),
    renderPlanters,
    renderCharacters,
};

const gamedatas = {
    planters: {
        501: { id: 501, location_arg: 7 },
        502: { id: 502, location_arg: 7 },
    },
    claimedCharacters: {
        901: { id: 901, type: 'Mushroom', location_arg: 7 },
    },
    plantsLevel3: {},
};
const orderedPlayers = [{ id: 7, name: 'Marty' }];

const runSetupBlock = new Function('gamedatas', 'orderedPlayers', ${JSON.stringify(perPlayerForEach)});
runSetupBlock.call(game, gamedatas, orderedPlayers);

const row = document.getElementById('player-garden-planters-7');
const childIds = row ? Array.from(row.children).map(el => el.id) : [];

const checks = [
    ['garden row was created', !!row],
    ['row has exactly 3 children (2 planters + 1 character)', childIds.length === 3],
    ['both planter slots render before the character card', childIds.indexOf('character_901') === 2],
    ['character card is the LAST child (rightmost)', childIds[childIds.length - 1] === 'character_901'],
    ['planter slots are present', childIds.includes('planter-slot_501') && childIds.includes('planter-slot_502')],
];
checks.forEach(([label, cond]) => log((cond ? 'ok' : 'FAIL') + ' — ' + label + ' (order: ' + childIds.join(',') + ')'));
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<div id="player-tables"></div>
<div id="results"></div>
<script>${script}</script>
</body></html>
`;

const dir = mkdtempSync(path.join(tmpdir(), 'plantopia-charcard-test-'));
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
