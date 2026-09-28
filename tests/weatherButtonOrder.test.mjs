/**
 * Regression test for https://trello.com/c/P3xyqIfJ
 * "Weather card option buttons should always be presented in the same order"
 *
 * WeatherPhaseChoose iterated Object.values(weatherHand) in whatever arbitrary
 * order the object happened to have, so the Sun/Rain/Wind buttons appeared in a
 * random order that differed per player and per weather phase. They must always
 * be Sun (type_arg 0), then Rain (1), then Wind (2), left to right — with
 * multiple cards of the same condition grouped together.
 *
 * Drives the REAL WeatherPhaseChoose extracted from Game.js, seeding a hand in
 * a deliberately shuffled order and asserting the rendered button order.
 *
 * Run: node tests/weatherButtonOrder.test.mjs
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../plantopia/modules/js/Game.js', import.meta.url), 'utf8');

function extractClass(name) {
    const startIdx = src.indexOf(`class ${name} {`);
    if (startIdx === -1) throw new Error(`extractClass: ${name} not found`);
    let depth = 0, i = startIdx;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
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

function condOf(label) {
    if (label.includes('Sun')) return 'Sun';
    if (label.includes('Rain')) return 'Rain';
    if (label.includes('Wind')) return 'Wind';
    return '?';
}

// Hand deliberately NOT in Sun/Rain/Wind order: Wind, Sun, Wind, Rain.
const game = { gamedatas: { weatherHand: {} } };
const wpc = new WeatherPhaseChoose(game, bga);
const shuffledArgs = {
    weatherHand: {
        901: { id: 901, type: 'carrot', type_arg: 2, location: 'hand', location_arg: 7 }, // Wind
        902: { id: 902, type: 'potato', type_arg: 0, location: 'hand', location_arg: 7 }, // Sun
        903: { id: 903, type: 'banana', type_arg: 2, location: 'hand', location_arg: 7 }, // Wind
        904: { id: 904, type: 'mushroom', type_arg: 1, location: 'hand', location_arg: 7 }, // Rain
    },
};

wpc.onEnteringState(shuffledArgs, true);
const order = buttonLog.map(condOf);
check('4 weather buttons rendered', order.length === 4, order);
check('buttons are grouped Sun -> Rain -> Wind regardless of hand order',
    order.join(',') === 'Sun,Rain,Wind,Wind', order);

// A hand missing a condition still keeps Sun-before-Wind ordering.
const game2 = { gamedatas: { weatherHand: {} } };
const wpc2 = new WeatherPhaseChoose(game2, bga);
wpc2.onEnteringState({ weatherHand: {
    801: { id: 801, type: 'carrot', type_arg: 2, location: 'hand', location_arg: 7 }, // Wind
    802: { id: 802, type: 'potato', type_arg: 0, location: 'hand', location_arg: 7 }, // Sun
} }, true);
check('Sun before Wind when Rain is absent', buttonLog.map(condOf).join(',') === 'Sun,Wind', buttonLog.map(condOf));

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
