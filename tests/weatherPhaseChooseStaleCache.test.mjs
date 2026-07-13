/**
 * Regression test for the https://trello.com/c/61uLM9hR follow-up sweep:
 * WeatherPhaseChoose's UI (one status button per held character weather
 * card) used to depend entirely on gamedatas.weatherHand being populated
 * by the receivedWeatherCards notification fired by WeatherPhaseGrow, a
 * full interactive PlantingPhase round earlier — the same shape of risk
 * that broke WeatherPhaseBonus. If that notification's queued processing
 * hadn't caught up by the time WeatherPhaseChoose rendered, the player
 * would see "you must choose a Weather card" with no buttons — the same
 * "title says act, nothing to click" symptom as the original bug.
 *
 * Fix: WeatherPhaseChoose::getArgs() now returns the player's held
 * character weather cards (via BGA's _private/_merge_private mechanism,
 * since hand contents are private), and onEnteringState() resyncs
 * gamedatas.weatherHand from args unconditionally on every entry.
 *
 * This test seeds gamedatas.weatherHand with STALE/WRONG data (simulating
 * a notification that hasn't landed yet) and confirms the real
 * onEnteringState resyncs from args and renders the correct buttons.
 *
 * Run: node tests/weatherPhaseChooseStaleCache.test.mjs
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

let failures = 0;
function check(label, cond, detail) {
    console.log('  ' + (cond ? 'ok' : 'FAIL') + ' — ' + label + (detail !== undefined ? ' (' + JSON.stringify(detail) + ')' : ''));
    if (!cond) failures++;
}

global._ = (s) => s;

const WeatherPhaseChoose = new Function('return (' + extractClass('WeatherPhaseChoose') + ');')();

let buttonLog = [];
const bga = {
    statusBar: {
        removeActionButtons: () => { buttonLog = []; },
        setTitle: () => {},
        addActionButton: (label) => { buttonLog.push(label); },
    },
    players: { getCurrentPlayerId: () => 7 },
    actions: { performAction: () => {} },
};

// Simulates a client where receivedWeatherCards (fired by WeatherPhaseGrow,
// well before this state) hasn't been processed yet — gamedatas.weatherHand
// is stuck reflecting an earlier, empty snapshot, while the player actually
// holds a Sun and a Rain character weather card per fresh server truth.
const game = { gamedatas: { weatherHand: {} } };
const wpc = new WeatherPhaseChoose(game, bga);

const freshArgsFromServer = {
    weatherHand: {
        701: { id: 701, type: 'carrot', type_arg: 0, location: 'hand', location_arg: 7 },
        702: { id: 702, type: 'potato', type_arg: 1, location: 'hand', location_arg: 7 },
    },
};

wpc.onEnteringState(freshArgsFromServer, true);
check('gamedatas.weatherHand resynced from args, not left as the stale empty cache',
    Object.keys(game.gamedatas.weatherHand).sort().join(',') === '701,702',
    game.gamedatas.weatherHand);
check('two weather choice buttons render (Sun for 701, Rain for 702) — not zero',
    buttonLog.some(l => l.includes('Sun')) && buttonLog.some(l => l.includes('Rain')),
    buttonLog);

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
