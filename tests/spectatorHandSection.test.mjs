/**
 * Regression test for https://trello.com/c/pbg3MAI0
 * "Spectator should not see 'My Hand' section"
 *
 * A spectator has no hand of their own, but setup() always inserted the
 * "My Hand" section anyway — a permanently-empty box with nothing to
 * show. Fixed by skipping that DOM insertion when
 * this.bga.players.isCurrentPlayerSpectator() is true. renderHand()
 * (called right after, and again from several notif_* handlers
 * throughout play) already no-ops safely when #my-hand-container
 * doesn't exist, so real players are completely unaffected — this test
 * confirms both halves: the panel is skipped for spectators, and
 * renderHand() doesn't throw when it's missing.
 *
 * Drives the REAL setup() snippet and the REAL renderHand() (extracted
 * from Game.js, not re-implemented) through headless Chrome.
 *
 * Run: node tests/spectatorHandSection.test.mjs
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

// The exact conditional block under test, extracted by bracket-matching
// from its known start marker so this test breaks loudly (extractMethod-
// style error) if the surrounding code is ever restructured, rather than
// silently testing stale logic.
function extractSpectatorHandBlock() {
    const marker = 'if (!this.bga.players.isCurrentPlayerSpectator()) {';
    const startIdx = src.indexOf(marker);
    if (startIdx === -1) throw new Error('extractSpectatorHandBlock: marker not found');
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

const spectatorHandBlock = extractSpectatorHandBlock();
const renderHandBody = extractMethod('renderHand');

const script = `
window.onerror = (msg, src, line, col, err) => {
    document.getElementById('results').innerHTML += 'FAIL — uncaught error: ' + msg + ' (line ' + line + ':' + col + ')' + (err && err.stack ? '<br>' + String(err.stack).replace(/\\n/g, ' | ') : '') + '<br>';
};

function check(label, cond, detail) {
    const line = (cond ? 'ok' : 'FAIL') + ' — ' + label + (detail !== undefined ? ' (' + JSON.stringify(detail) + ')' : '');
    document.getElementById('results').innerHTML += line + '<br>';
}

function freshGame(isSpectator) {
    return {
        bga: { players: { isCurrentPlayerSpectator: () => isSpectator } },
        gamedatas: { plantCardTypes: {} },
        isAdult: () => false,
        isBabyType: () => false,
        plantCardBody: () => ({ extraClass: '', dataAttr: '', inner: '' }),
        addPlantTooltip: () => {},
        renderHand: new Function('handData', 'weatherHandData', ${JSON.stringify(renderHandBody)}),
    };
}

// ── Non-spectator: the hand panel IS created, exactly as before ──
document.getElementById('scenario-a').insertAdjacentHTML('afterbegin', '<div id="player-tables"></div>');
const gameA = freshGame(false);
(new Function(${JSON.stringify(spectatorHandBlock)})).call(gameA);
check('non-spectator: #hand_panel exists', document.getElementById('hand_panel') !== null);
check('non-spectator: #my-hand-container exists', document.getElementById('my-hand-container') !== null);

// renderHand() on a real player must still work exactly as before.
gameA.renderHand.call(gameA, { 501: { id: 501, type: 'Cutetus' } }, null);
check('non-spectator: renderHand() populates the container', document.getElementById('my-hand-container').children.length === 1);

// ── Spectator: the hand panel must NOT be created ──
document.getElementById('scenario-b').insertAdjacentHTML('afterbegin', '<div id="player-tables"></div>');
const gameB = freshGame(true);
(new Function(${JSON.stringify(spectatorHandBlock)})).call(gameB);
check('spectator: #hand_panel was NOT created', document.getElementById('scenario-b').querySelector('#hand_panel') === null);
check('spectator: #my-hand-container was NOT created', document.getElementById('scenario-b').querySelector('#my-hand-container') === null);

// renderHand() must not throw even though the container doesn't exist —
// this is what keeps every later notif_* re-render safe for spectators.
let threw = false;
try {
    gameB.renderHand.call(gameB, { 501: { id: 501, type: 'Cutetus' } }, null);
} catch (e) {
    threw = true;
}
check('spectator: renderHand() does not throw when the container is missing', !threw);

check('reached the end without a silent early termination', true);
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<div id="scenario-a"></div>
<div id="scenario-b"></div>
<div id="results"></div>
<script>${script}</script>
</body></html>
`;

const dir = mkdtempSync(path.join(tmpdir(), 'plantopia-spectator-hand-test-'));
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
let sawSentinel = false;
for (const line of lines) {
    console.log('  ' + line);
    if (line.startsWith('FAIL')) failures++;
    if (line.includes('reached the end without a silent early termination')) sawSentinel = true;
}
if (!sawSentinel) {
    console.log('  FAIL — script terminated early (sentinel line never printed)');
    failures++;
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
