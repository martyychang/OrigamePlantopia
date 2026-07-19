/**
 * Regression test for https://trello.com/c/XZgYk9h9
 * "Model plant family selection after weather card selection"
 *
 * Violet's `level_up_family` effect used to render its Tree/Flower/Cactus
 * choice as three DIFFERENTLY-colored status buttons (green/red/blue) —
 * confusing, since the colors didn't map to anything (not the plant's own
 * card color, not a semantic meaning), unlike every other multi-choice
 * status-bar prompt in the game (e.g. WeatherPhaseChoose's Sun/Rain/Wind
 * buttons), which are all the same color and differentiated by an emoji +
 * label instead.
 *
 * Fix: PlantingPhase.renderPendingEffect's 'level_up_family' branch now
 * renders all three buttons blue, each prefixed with the emoji Marty
 * specified on the card (🌲 Tree / 🌹 Flower / 🌵 Cactus).
 *
 * This drives the REAL PlantingPhase class (same extraction technique as
 * tests/draftConfirmStatusButton.test.mjs) through headless Chrome.
 *
 * Run: node tests/levelUpFamilyButtons.test.mjs
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
const bga = {
    statusBar: {
        removeActionButtons: () => { buttonLog.length = 0; },
        setTitle: (t) => titleLog.push(t),
        addActionButton: (label, cb, opts) => { buttonLog.push({ label, color: opts && opts.color }); },
    },
    players: { getCurrentPlayerId: () => 7 },
    actions: { performAction: () => {} },
};

const game = { gamedatas: {} };

const PlantingPhase = new Function(${JSON.stringify('return (' + classSrc + ');')})();
const pp = new PlantingPhase(game, bga);

function check(label, cond, detail) {
    const line = (cond ? 'ok' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : '');
    document.getElementById('results').innerHTML += line + '<br>';
}

pp.renderPendingEffect({ type: 'level_up_family' });

check('title is "Choose a plant family to grow"', titleLog.includes('Choose a plant family to grow'), JSON.stringify(titleLog));

const familyButtons = buttonLog.filter(b => b.label !== 'Skip');
check('exactly 3 family buttons render (plus Skip, checked separately)', familyButtons.length === 3, JSON.stringify(buttonLog));
check('every family button is blue, matching the weather-selection buttons (not green/red/blue mixed)',
    familyButtons.every(b => b.color === 'blue'), JSON.stringify(familyButtons));
check('Tree button carries the evergreen_tree emoji', familyButtons.some(b => b.label === '🌲 Tree'), JSON.stringify(familyButtons));
check('Flower button carries the rose emoji', familyButtons.some(b => b.label === '🌹 Flower'), JSON.stringify(familyButtons));
check('Cactus button carries the cactus emoji', familyButtons.some(b => b.label === '🌵 Cactus'), JSON.stringify(familyButtons));
check('a Skip button is still offered (unrelated to this fix, must not regress)',
    buttonLog.some(b => b.label === 'Skip'), JSON.stringify(buttonLog));
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<div id="results"></div>
<script>${script}</script>
</body></html>
`;

const dir = mkdtempSync(path.join(tmpdir(), 'plantopia-levelupfamily-test-'));
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
