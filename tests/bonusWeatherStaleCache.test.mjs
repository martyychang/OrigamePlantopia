/**
 * Regression test for https://trello.com/c/61uLM9hR
 * "No way to select a bonus weather card until page reload"
 *
 * Reported repro: after playing SOME (not all) held Bonus Weather cards in
 * one round and keeping the rest, the NEXT Weather Phase shows "Play Bonus
 * Weather" but the selection screen inside it offers only Skip — no
 * condition buttons for the still-held cards. Reloading the page always
 * fixes it. Follow-up to https://trello.com/c/Tyxs3bcd (which replaced the
 * dead tile-click selection with status buttons, making this pre-existing,
 * previously-unreachable bug visible for the first time).
 *
 * Root cause: gamedatas.weatherPublicBonus was kept in sync ENTIRELY via
 * live notifications (incremental add/delete on gain/play, plus a full
 * resync from the weatherCleared notification fired one state earlier by
 * WeatherPhaseGrow). BGA Studio documents that notifications are queued
 * and paced separately from state-transition rendering (for animation
 * purposes) — onEnteringState's args (from getArgs()) are evaluated
 * synchronously as part of entering the new state, but a notification
 * fired by an EARLIER auto-transitioning state is not guaranteed to have
 * finished being processed by the time this state's UI renders. If
 * WeatherPhaseBonus rendered before weatherCleared's queued processing
 * caught up, gamedatas.weatherPublicBonus could be stale at exactly the
 * moment this state's UI needs it — with nothing to repair it until
 * something re-fetches everything synchronously (a page reload).
 *
 * Fix: WeatherPhaseBonus::getArgs() now returns weather_public_bonus
 * directly (fresh, read synchronously as part of entering this exact
 * state), and onEnteringState() resyncs gamedatas.weatherPublicBonus from
 * args every time — the same "sync via getArgs() on state entry, don't
 * rely on notification timing" pattern documented in AGENTS.md under
 * "State Transitions & Frontend Synchronization" (and already used
 * successfully for other data in this game).
 *
 * This test proves the GENERAL PRINCIPLE the fix establishes — args must
 * win over whatever gamedatas.weatherPublicBonus already holds, regardless
 * of why the cache might be stale — by deliberately seeding gamedatas with
 * WRONG data (simulating a notification that hasn't landed yet, for
 * whatever reason) and confirming the real onEnteringState resyncs from
 * args correctly.
 *
 * Run: node tests/bonusWeatherStaleCache.test.mjs
 */
import { readFileSync } from 'node:fs';

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

const wpbClassSrc = extractClass('WeatherPhaseBonus');

let failures = 0;
function check(label, cond, detail) {
    console.log('  ' + (cond ? 'ok' : 'FAIL') + ' — ' + label + (detail !== undefined ? ' (' + JSON.stringify(detail) + ')' : ''));
    if (!cond) failures++;
}

// cleanupUI() touches document.querySelectorAll — irrelevant to this
// data-flow question, so a minimal no-op stub is enough (no headless
// Chrome needed here).
global.document = { querySelectorAll: () => [] };
global._ = (s) => s;

const WeatherPhaseBonus = new Function('return (' + wpbClassSrc + ');')();

let buttonLog = [];
const buttonCallbacks = {};
const bga = {
    statusBar: {
        removeActionButtons: () => { buttonLog = []; },
        setTitle: () => {},
        addActionButton: (label, cb) => { buttonLog.push(label); buttonCallbacks[label] = cb; },
    },
    players: { getCurrentPlayerId: () => 7 },
    actions: { performAction: () => {} },
};

// Simulates a client where the weatherCleared notification (fired by
// WeatherPhaseGrow, one state before WeatherPhaseBonus) has NOT been
// processed yet — gamedatas.weatherPublicBonus is stuck reflecting an
// earlier snapshot: only card 901 (Sun), when the player actually holds
// 902 (Sun) and 903 (Rain) too, per fresh server truth.
const game = {
    gamedatas: {
        weatherPublicBonus: {
            901: { id: 901, type: 'bonus', type_arg: 0, location_arg: 7 },
        },
    },
};
const wpb = new WeatherPhaseBonus(game, bga);

// getArgs() on the PHP side now returns fresh weather_public_bonus data —
// this is what the server would actually send, synchronously, as part of
// entering this exact state, regardless of notification timing.
const freshArgsFromServer = {
    weatherPublicBonus: {
        902: { id: 902, type: 'bonus', type_arg: 0, location_arg: 7 },
        903: { id: 903, type: 'bonus', type_arg: 1, location_arg: 7 },
    },
};

wpb.onEnteringState(freshArgsFromServer, true);
check('gamedatas.weatherPublicBonus resynced from args, not left as the stale cached value',
    Object.keys(game.gamedatas.weatherPublicBonus).sort().join(',') === '902,903',
    game.gamedatas.weatherPublicBonus);

buttonCallbacks['Play Bonus Weather']();
check('selecting mode shows buttons for the FRESH held cards (Sun 902, Rain 903), not the stale one (901)',
    buttonLog.includes('☀️ Sun') && buttonLog.includes('💧 Rain'),
    buttonLog);

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
