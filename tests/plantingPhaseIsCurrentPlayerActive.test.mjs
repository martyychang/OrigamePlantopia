/**
 * Regression/hardening test for https://trello.com/c/e55vsa8Q
 * "Harden PlantingPhase client state against the same isCurrentPlayerActive
 * anti-pattern as WeatherPhaseBonus"
 *
 * Follow-up to https://trello.com/c/DCpOIanp (WeatherPhaseBonus fix). That
 * bug's client-side cause was a redundant, custom-cached "am I done" check
 * layered on top of BGA's own isCurrentPlayerActive signal
 * (`if (!isCurrentPlayerActive) return waiting; ... if (status == 1) return
 * waiting;`). PlantingPhase's client class had the exact same shape of
 * redundant check, using `gamedatas.players[pId].planting_status == 1`.
 * Unlike WeatherPhaseBonus, this was never reported as actually broken
 * (PlantingPhase legitimately owns this field — no cross-state collision),
 * but the same latent race applies: if a live onEnteringState() ever ran
 * with stale/partial args, the redundant check could win over
 * isCurrentPlayerActive and wrongly lock the player into "waiting" until a
 * reload.
 *
 * Fix mirrors WeatherPhaseBonus exactly: isCurrentPlayerActive is now the
 * sole signal for the waiting/active gate, with a private, instance-scoped
 * `justActed` flag (reset every onEnteringState, never written to shared
 * gamedatas) for immediate feedback right after the player's own action.
 * The `status == 2 || status == 3` (ResolvingEffects) branch is
 * DELIBERATELY preserved as `status == 3` only — that's real, additional
 * information beyond simple active/inactive (PlantingPlayerSubstate.php
 * only ever defines 0/1/3, never 2 — see that enum's doc comment), not a
 * redundant "am I active" re-check, so it still needs synced server truth
 * and isn't touched by this fix.
 *
 * This test extracts the REAL PlantingPhase class and proves:
 * 1. Stale planting_status=1 (as if some future bug set it) no longer
 *    matters — isCurrentPlayerActive=true and justActed=false must show
 *    real planting actions, not "waiting".
 * 2. justActed=true still correctly forces "waiting" even when
 *    isCurrentPlayerActive=true (the optimistic self-feedback still works).
 * 3. status=3 (ResolvingEffects) still shows the "Resolving effects..."
 *    prompt when active and not justActed.
 *
 * Run: node tests/plantingPhaseIsCurrentPlayerActive.test.mjs
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

const classSrc = extractClass('PlantingPhase');

// classSrc contains raw backticks/template literals (real production code) —
// embed as a JSON string literal, not direct template interpolation, so it
// can't break THIS file's own template parsing. Same technique as the other
// headless-Chrome tests in this suite.
const script = `
function _(s) { return s; }

function makeHarness() {
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
            players: { 7: { planting_status: 0, pending_effects: '[]' } },
            hand: {},
        },
    };
    const PlantingPhase = new Function(${JSON.stringify('return (' + classSrc + ');')})();
    const pp = new PlantingPhase(game, bga);
    return { pp, game, titleLog, buttonLog };
}

function log(line) { document.getElementById('results').innerHTML += line + '<br>'; }
const results = [];

// ── Case 1: stale planting_status=1, isCurrentPlayerActive=true, justActed
// untouched (fresh onEnteringState resets it) — must show REAL actions,
// not "waiting", proving status==1 is no longer read at all. ──
{
    const { pp, game, titleLog, buttonLog } = makeHarness();
    game.gamedatas.players[7].planting_status = 1; // stale/leftover, as if some future bug set it
    pp.onEnteringState(null, true);
    const waited = titleLog.some(t => t.includes('Waiting for other players'));
    const gotPlantButton = buttonLog.includes('Plant');
    results.push(['stale planting_status=1 does NOT force waiting (isCurrentPlayerActive=true wins)', !waited && gotPlantButton, JSON.stringify({ titleLog, buttonLog })]);
}

// ── Case 2: justActed=true forces waiting even though isCurrentPlayerActive
// is (hypothetically) still true — the optimistic self-feedback path. ──
{
    const { pp, game, titleLog, buttonLog } = makeHarness();
    pp.onEnteringState(null, true);
    titleLog.length = 0; buttonLog.length = 0; // clear the entry render, isolate the next call
    pp.justActed = true;
    pp.onPlayerActivationChange(null, true);
    const waited = titleLog.some(t => t.includes('Waiting for other players'));
    results.push(['justActed=true forces waiting regardless of isCurrentPlayerActive', waited && buttonLog.length === 0, JSON.stringify({ titleLog, buttonLog })]);
}

// ── Case 3: status=3 (ResolvingEffects), active, not justActed — must show
// the resolving-effects prompt, not the normal action UI or waiting. ──
{
    const { pp, game, titleLog, buttonLog } = makeHarness();
    game.gamedatas.players[7].planting_status = 3;
    game.gamedatas.players[7].pending_effects = '[]'; // empty queue -> generic "Resolving effects..." title
    pp.onEnteringState(null, true);
    const gotResolving = titleLog.some(t => t.includes('Resolving effects'));
    const gotPlantButton = buttonLog.includes('Plant');
    results.push(['status=3 (ResolvingEffects) shows the resolving-effects prompt, not normal actions', gotResolving && !gotPlantButton, JSON.stringify({ titleLog, buttonLog })]);
}

// ── Case 4: onEnteringState always resets justActed — a fresh entry must
// never inherit a stale justActed=true from a previous round. ──
{
    const { pp } = makeHarness();
    pp.justActed = true;
    pp.onEnteringState(null, true);
    results.push(['onEnteringState resets justActed to false', pp.justActed === false, '']);
}

results.forEach(([label, cond, detail]) => log((cond ? 'ok' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : '')));
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<div id="results"></div>
<script>${script}</script>
</body></html>
`;

const dir = mkdtempSync(path.join(tmpdir(), 'plantopia-plantingphase-test-'));
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
