/**
 * Regression test for https://trello.com/c/YJXNQMHM
 * "The 'Confirm' button should be rendered as a status button"
 *
 * The draft "Choose N Card(s) to Keep" flow (PlantingPhase.renderDraftModal)
 * used to build its own raw HTML <button class="bga-button bga-button_blue">
 * inside a plain <div id="draft-actions"> in the dark draft-container
 * overlay — visually an oddly full-width, stretched button, unlike every
 * other action in the game (Plant/Grow/Draw5, Cancel, Confirm Discard,
 * Done/Skip, etc.), which all go through
 * this.bga.statusBar.addActionButton(...) and render as compact, colored
 * status bar buttons.
 *
 * Fix: renderDraftModal now calls this.bga.statusBar.addActionButton(...)
 * for Confirm too, shown only once the right number of cards is selected —
 * the same "add the button only when ready" pattern already used by
 * Confirm Discard (renderPendingEffect's discard_cards branch) and
 * WeatherPhaseBonus's Done/Skip buttons, which achieves the same
 * can't-confirm-prematurely behavior without a disabled-button API. The
 * #draft-actions div and the raw <button> element are gone entirely.
 *
 * This drives the REAL PlantingPhase class (same extraction technique as
 * tests/plantingPhaseIsCurrentPlayerActive.test.mjs) through headless
 * Chrome, simulating card clicks and inspecting both the DOM (no stray
 * bga-button element) and the status bar stub (Confirm button appears/
 * disappears at the right times and performs the right action).
 *
 * Run: node tests/draftConfirmStatusButton.test.mjs
 * Requires: Google Chrome at the path below (macOS default location).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const src = readFileSync(new URL('../plantopia/modules/js/Game.js', import.meta.url), 'utf8');

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

const classSrc = extractClass('PlantingPhase');

const script = `
function _(s) { return s; }

const titleLog = [];
const buttonLog = [];
let lastPerformAction = null;
const bga = {
    statusBar: {
        removeActionButtons: () => { buttonLog.length = 0; },
        setTitle: (t) => titleLog.push(t),
        addActionButton: (label, cb) => { buttonLog.push(label); bga._lastCb = cb; },
    },
    players: { getCurrentPlayerId: () => 7 },
    actions: { performAction: (name, args) => { lastPerformAction = { name, args }; } },
    gameArea: { getElement: () => document.getElementById('game-area') },
};

const game = {
    gamedatas: {
        draftCards: {
            901: { id: 901, type: 'Cattus' },
            902: { id: 902, type: 'Cutetus' },
            903: { id: 903, type: 'Battus' },
        },
        plantCardTypes: {
            Cattus: { name: 'Cattus', cost: 1 },
            Cutetus: { name: 'Cutetus', cost: 1 },
            Battus: { name: 'Battus', cost: 2 },
        },
    },
    plantCardBody: () => ({ extraClass: '', dataAttr: '', inner: 'card' }),
    addPlantTooltip: () => {},
};

const PlantingPhase = new Function(${JSON.stringify('return (' + classSrc + ');')})();
const pp = new PlantingPhase(game, bga);

// Log immediately after each check, not accumulate-then-emit-at-the-end —
// a later check throwing (e.g. calling a callback that pre-fix code never
// set) must not silently erase every result that came before it.
function check(label, cond, detail) {
    const line = (cond ? 'ok' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : '');
    document.getElementById('results').innerHTML += line + '<br>';
}

// Choose 2 of 3 cards.
pp.renderDraftModal(2);

check('no raw HTML button in the draft modal (no #draft-actions, no .bga-button element)',
    !document.getElementById('draft-actions') && !document.querySelector('#draft-container button'),
    'draft-actions=' + !!document.getElementById('draft-actions'));
check('no Confirm button yet with 0 cards selected', !buttonLog.includes('Confirm'), JSON.stringify(buttonLog));

document.getElementById('draft_901').onclick();
check('still no Confirm button with 1/2 selected', !buttonLog.includes('Confirm'), JSON.stringify(buttonLog));

document.getElementById('draft_902').onclick();
check('Confirm button appears via statusBar.addActionButton once 2/2 selected', buttonLog.includes('Confirm'), JSON.stringify(buttonLog));

// Deselect one card — Confirm must disappear again (not stay stuck visible).
document.getElementById('draft_901').onclick();
check('Confirm button disappears again after deselecting back to 1/2', !buttonLog.includes('Confirm'), JSON.stringify(buttonLog));

// Re-select to reach 2/2 and click Confirm. Guard the callback call itself —
// pre-fix code never populates bga._lastCb (it never calls addActionButton
// at all), so this check must FAIL cleanly, not throw and abort the script.
document.getElementById('draft_901').onclick();
if (bga._lastCb) bga._lastCb();
check('Confirm performs actResolveDraft with the selected card ids',
    !!lastPerformAction && lastPerformAction.name === 'actResolveDraft' && lastPerformAction.args.cardIdsStr === '902;901',
    JSON.stringify(lastPerformAction));
check('draft-container is removed after confirming', !document.getElementById('draft-container'), '');
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<div id="game-area"></div>
<div id="results"></div>
<script>${script}</script>
</body></html>
`;

const dir = mkdtempSync(path.join(tmpdir(), 'plantopia-draftconfirm-test-'));
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
