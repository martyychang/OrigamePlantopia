/**
 * Regression test for https://trello.com/c/Tyxs3bcd
 * "No way to select bonus weather cards to play"
 *
 * Root cause: the Bonus Weather selection UI highlighted and attached
 * onclick handlers to document.getElementById(`weather_${c.id}`) for each
 * card in the player's held stash — but bonus weather cards stopped being
 * rendered as board tiles entirely back in https://trello.com/c/uiJWdVTg
 * ("counted only, not displayed as garden tiles"). That left the
 * `if (el) { ... }` guard silently skipping every card, so there was no DOM
 * element to click at all — a player who clicked "Play Bonus Weather" saw
 * "you must select Bonus Weather cards to play" with nothing clickable
 * anywhere on the page.
 *
 * Fix: present one status action button per weather condition
 * (☀️ Sun / 💧 Rain / 🌬️ Wind) the player still holds an unselected card
 * of — the same status-bar-button pattern WeatherPhaseChoose already uses
 * for picking the character weather card to play — instead of clicking a
 * card tile. Clicking a condition button adds one held card of that type to
 * the turn's selection. Once every held card has been added, the selection
 * auto-submits (as if Done were clicked) rather than waiting for an
 * explicit click; before that point, Done submits whatever's been selected
 * so far, mirroring the existing partial-selection behavior.
 *
 * This drives the REAL WeatherPhaseBonus class (same extraction technique
 * as the other headless-Chrome tests in this suite) through several clicks
 * and checks both the status bar button set at each step and the final
 * server call.
 *
 * Run: node tests/bonusWeatherStatusButtons.test.mjs
 * Requires: Google Chrome at the path below (macOS default location).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const src = readFileSync(new URL('../origameplantopia/modules/js/Game.js', import.meta.url), 'utf8');

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

const classSrc = extractClass('WeatherPhaseBonus');

const script = `
function _(s) { return s; }

let buttonLog = [];
const buttonCallbacks = {};
let lastPerformAction = null;
const bga = {
    statusBar: {
        removeActionButtons: () => { buttonLog = []; },
        setTitle: () => {},
        addActionButton: (label, cb) => { buttonLog.push(label); buttonCallbacks[label] = cb; },
    },
    players: { getCurrentPlayerId: () => 7 },
    actions: { performAction: (name, args) => { lastPerformAction = { name, args }; } },
};
// applyBonusWeatherPlayed itself (garden tile + player panel refresh) has
// its own dedicated test — bonusWeatherPlayedVisuals.test.mjs. Here it's
// stubbed as a tracking spy: this test's job is to confirm
// WeatherPhaseBonus calls it at the right moment with the right card,
// not to re-verify its internals.
const appliedPlays = [];
const game = {
    gamedatas: {
        // Player 7 holds 2 Sun (type_arg 0) + 1 Rain (type_arg 1), no Wind.
        weatherPublicBonus: {
            801: { id: 801, type: 'bonus', type_arg: 0, location_arg: 7 },
            802: { id: 802, type: 'bonus', type_arg: 0, location_arg: 7 },
            803: { id: 803, type: 'bonus', type_arg: 1, location_arg: 7 },
        },
    },
    applyBonusWeatherPlayed: (card, playerId) => { appliedPlays.push({ cardId: card.id, playerId }); },
};

const WeatherPhaseBonus = new Function(${JSON.stringify('return (' + classSrc + ');')})();
const wpb = new WeatherPhaseBonus(game, bga);

function check(label, cond, detail) {
    const line = (cond ? 'ok' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : '');
    document.getElementById('results').innerHTML += line + '<br>';
}

wpb.onEnteringState(null, true);
check('entry offers "Play Bonus Weather"', buttonLog.includes('Play Bonus Weather'), JSON.stringify(buttonLog));

buttonCallbacks['Play Bonus Weather']();
check('selecting mode: Sun and Rain buttons shown (2 held types), no Wind (0 held), Skip shown (nothing selected yet)',
    buttonLog.includes('☀️ Sun') && buttonLog.includes('💧 Rain') && !buttonLog.includes('🌬️ Wind') && buttonLog.includes('Skip'),
    JSON.stringify(buttonLog));
check('no raw card-tile click handler is needed — buttons ARE the only way to act', !buttonLog.includes('Done'), JSON.stringify(buttonLog));

buttonCallbacks['☀️ Sun']();
check('after selecting 1 of 3: Sun (1 left) and Rain still offered, Done now shown instead of Skip',
    buttonLog.includes('☀️ Sun') && buttonLog.includes('💧 Rain') && buttonLog.includes('Done') && !buttonLog.includes('Skip'),
    JSON.stringify(buttonLog));
check('nothing submitted to the server yet', lastPerformAction === null, JSON.stringify(lastPerformAction));
check('applyBonusWeatherPlayed called immediately for the clicked card (801), before Done/submit — https://trello.com/c/rvSEQag1',
    appliedPlays.length === 1 && appliedPlays[0].cardId === 801 && appliedPlays[0].playerId === 7,
    JSON.stringify(appliedPlays));

buttonCallbacks['💧 Rain']();
check('after selecting 2 of 3 (both Sun and Rain used up... wait, 1 Sun left): Sun still offered, Rain gone (0 left)',
    buttonLog.includes('☀️ Sun') && !buttonLog.includes('💧 Rain') && buttonLog.includes('Done'),
    JSON.stringify(buttonLog));
check('applyBonusWeatherPlayed called again for the Rain card (803), immediately on that click too',
    appliedPlays.length === 2 && appliedPlays[1].cardId === 803,
    JSON.stringify(appliedPlays));

// Selecting the last remaining held card must auto-submit exactly as if
// Done had been clicked — no explicit Done click needed.
buttonCallbacks['☀️ Sun']();
check('selecting the last held card auto-submits (performAction called without an explicit Done click)',
    !!lastPerformAction && lastPerformAction.name === 'actPlayBonusWeather',
    JSON.stringify(lastPerformAction));
check('auto-submit includes all 3 held card ids', lastPerformAction && lastPerformAction.args.cardIds.split(';').sort().join(',') === '801,802,803',
    lastPerformAction ? lastPerformAction.args.cardIds : 'none');
check('selectingBonus resets to false after submit', wpb.selectingBonus === false, '');
check('selectedBonusCards resets to empty after submit', Array.isArray(wpb.selectedBonusCards) && wpb.selectedBonusCards.length === 0, '');
check('applyBonusWeatherPlayed was called for all 3 cards by the time auto-submit fired (once per click, not once per submit)',
    appliedPlays.length === 3 && appliedPlays.map(p => p.cardId).sort().join(',') === '801,802,803',
    JSON.stringify(appliedPlays));

// ── Separately: explicit Done with a PARTIAL selection (not all cards) ──
lastPerformAction = null;
appliedPlays.length = 0;
wpb.onEnteringState(null, true);
buttonCallbacks['Play Bonus Weather']();
buttonCallbacks['💧 Rain']();
check('partial selection (1 of 3): Done button available to submit early', buttonLog.includes('Done'), JSON.stringify(buttonLog));
check('applyBonusWeatherPlayed already called for the Rain card even though Done has not been clicked yet',
    appliedPlays.length === 1 && appliedPlays[0].cardId === 803, JSON.stringify(appliedPlays));
buttonCallbacks['Done']();
check('explicit Done submits just the partial selection', !!lastPerformAction && lastPerformAction.args.cardIds === '803', JSON.stringify(lastPerformAction));
check('applyBonusWeatherPlayed was not called again by Done itself — it already ran at click time', appliedPlays.length === 1, JSON.stringify(appliedPlays));

// Sentinel: a script that throws partway through (e.g. a missing stub on
// the fake game/bga object) can silently produce zero FAIL lines among
// whatever DID run before it died — this checks the whole script actually
// reached the end, not just that nothing failed along the way.
check('test script reached the end without a silent early termination', true);
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<div id="results"></div>
<script>${script}</script>
</body></html>
`;

const dir = mkdtempSync(path.join(tmpdir(), 'plantopia-bonusweatherbtn-test-'));
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

// A script that throws partway through can leave zero FAIL lines among
// whatever ran before it died — checking for the final sentinel line
// (rather than just "no FAILs seen") is what actually catches that.
if (!lines.some(l => l.includes('reached the end without a silent early termination'))) {
    console.error('FAIL — script did not reach its final sentinel check; it likely threw partway through');
    failures++;
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
