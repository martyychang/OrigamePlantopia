/**
 * Regression test for https://trello.com/c/DCpOIanp
 * "Both players waiting for the other player to finish playing bonus
 * weather cards" — stuck immediately on entering WeatherPhaseBonus, for
 * BOTH players, before either had acted. Reloading the page always fixed
 * it.
 *
 * ROOT CAUSE (confirmed by reading the code, not guessed): the client-side
 * WeatherPhaseBonus state class reused gamedatas.players[pId].planting_status
 * — a field name and column OWNED by the unrelated PlantingPhase state
 * class — to track "has this player finished their Bonus Weather
 * decision". Both state classes coincidentally use the value 1 to mean
 * "done with my current interactive step" (PlantingPhase: done planting;
 * WeatherPhaseBonus: passed/played bonus weather). Every player reaches
 * WeatherPhaseBonus immediately after finishing a real PlantingPhase in the
 * SAME round, which leaves gamedatas.players[pId].planting_status = 1 for
 * BOTH players the instant WeatherPhaseBonus begins. WeatherPhaseBonus's
 * own onEnteringState tried to overwrite this from fresh server args before
 * evaluating it — but that reset depended on args reliably being fresh
 * every single live transition, with no fallback if it wasn't. A page
 * reload always goes through setup(), which unconditionally rebuilds
 * gamedatas from scratch — masking the symptom instead of the cause. Server
 * DB columns were already correctly split earlier (player_planting_status
 * vs player_bonus_weather_status — see WeatherPhaseBonusSubstateTest.php),
 * but the parallel CLIENT field collision was never fixed until now.
 *
 * FIX: WeatherPhaseBonus no longer reads or writes planting_status at all.
 * It trusts isCurrentPlayerActive (BGA's own authoritative multiactive-
 * player tracking, not something this game's code maintains) as the sole
 * signal for whether to show "waiting", with a private, instance-scoped
 * `justActed` flag (reset every onEnteringState) for immediate optimistic
 * feedback right after the player's OWN action — never written to shared
 * gamedatas, so no other state class can ever read or clobber it.
 *
 * This test proves the fix by extracting the REAL WeatherPhaseBonus class
 * (not a re-implementation) and driving it with a STALE
 * gamedatas.players[pId].planting_status = 1 (simulating the exact leftover
 * value from this round's just-finished PlantingPhase) plus
 * isCurrentPlayerActive = true (what the framework correctly reports,
 * matching the "It's your turn!" banner in the bug's screenshots). The
 * fixed code must show real actions regardless of that stale value; the
 * pre-fix code incorrectly shows "Waiting for other players..." instead.
 *
 * Run: node tests/weatherPhaseBonusStaleStatus.test.mjs
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

const classSrc = extractClass('WeatherPhaseBonus');

// classSrc contains raw backticks/template literals (real production code) —
// embed it as a JSON string literal, not direct template interpolation, so
// it can't break THIS file's own template literal parsing. Same technique
// as the other headless-Chrome tests in this suite.
const script = `
function _(s) { return s; }

const titleLog = [];
const buttonLog = [];
const bga = {
    statusBar: {
        removeActionButtons: () => {},
        setTitle: (t) => titleLog.push(t),
        addActionButton: (label) => buttonLog.push(label),
    },
    players: { getCurrentPlayerId: () => 7 },
    actions: { performAction: () => {} },
};

const game = {
    gamedatas: {
        // Stale leftover from this round's PlantingPhase — both players
        // finish planting (status 1 = "done") before ever reaching
        // WeatherPhaseBonus in the same round.
        players: { 7: { planting_status: 1 } },
        weatherPublicBonus: {},
    },
};

const WeatherPhaseBonus = new Function(${JSON.stringify('return (' + classSrc + ');')})();
const wpb = new WeatherPhaseBonus(game, bga);

// Simulate fresh entry into WeatherPhaseBonus: the server has just set
// this player's real substate to Deciding and the framework correctly
// reports them active (isCurrentPlayerActive = true) — matching the "It's
// your turn!" banner in the bug's screenshots. args is null/empty, same as
// what the simplified getArgs() now always sends.
wpb.onEnteringState(null, true);

function log(line) { document.getElementById('results').innerHTML += line + '<br>'; }

const showedWaiting = titleLog.some(t => t.includes('Waiting for other players'));
const showedRealAction = titleLog.some(t => t.includes('may play Bonus Weather') || t.includes('must proceed to Grow Plants'));

const checks = [
    ['did NOT show "Waiting for other players..." despite stale planting_status=1', !showedWaiting],
    ['showed a real Bonus Weather action title', showedRealAction],
    ['added at least one action button (Proceed to Grow Plants)', buttonLog.length > 0],
];
checks.forEach(([label, cond]) => log((cond ? 'ok' : 'FAIL') + ' — ' + label + ' (titles: ' + JSON.stringify(titleLog) + ', buttons: ' + JSON.stringify(buttonLog) + ')'));
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<div id="results"></div>
<script>${script}</script>
</body></html>
`;

const dir = mkdtempSync(path.join(tmpdir(), 'plantopia-weatherbonus-test-'));
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
