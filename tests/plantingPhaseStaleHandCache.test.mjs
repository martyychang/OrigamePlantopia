/**
 * Regression test for the https://trello.com/c/61uLM9hR follow-up sweep:
 * PlantingPhase's client class used to depend entirely on
 * gamedatas.hand being populated by the cardsDrawn notification fired by
 * the immediately preceding PlantingPhaseUpkeep state — the same shape of
 * risk (narrower window, since it's one hop away rather than several) that
 * broke WeatherPhaseBonus. If that notification's queued processing hadn't
 * caught up by the time PlantingPhase rendered, the just-drawn card would
 * be missing from the player's hand until something else corrected it.
 *
 * Fix: PlantingPhase::getArgs() now returns the player's hand (via BGA's
 * _private/_merge_private mechanism, since hand contents are private), and
 * onEnteringState() resyncs gamedatas.hand from args and explicitly
 * re-renders it unconditionally on every entry — not waiting for the
 * notification to have already done so.
 *
 * This test seeds gamedatas.hand with STALE/INCOMPLETE data (simulating a
 * notification that hasn't landed yet — missing the just-drawn card) and
 * confirms the real onEnteringState resyncs from args and re-renders.
 *
 * Run: node tests/plantingPhaseStaleHandCache.test.mjs
 */
import { readFileSync } from 'node:fs';

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

let failures = 0;
function check(label, cond, detail) {
    console.log('  ' + (cond ? 'ok' : 'FAIL') + ' — ' + label + (detail !== undefined ? ' (' + JSON.stringify(detail) + ')' : ''));
    if (!cond) failures++;
}

global.document = { querySelectorAll: () => [], getElementById: () => null };
global._ = (s) => s;

const PlantingPhase = new Function('return (' + extractClass('PlantingPhase') + ');')();

const bga = {
    statusBar: { removeActionButtons: () => {}, setTitle: () => {}, addActionButton: () => {} },
    players: { getCurrentPlayerId: () => 7 },
};

let renderHandCalls = [];
// Simulates a client where cardsDrawn (fired by the immediately preceding
// PlantingPhaseUpkeep state) hasn't been processed yet — gamedatas.hand is
// stuck at 2 cards, missing the 3rd (just-drawn) card fresh server truth
// already reflects.
const game = {
    gamedatas: {
        hand: {
            501: { id: 501, type: 'Cattus' },
            502: { id: 502, type: 'Cutetus' },
        },
        weatherHand: {},
        players: { 7: { pending_effects: '[]' } },
    },
    renderHand: (hand, weatherHand) => { renderHandCalls.push({ hand, weatherHand }); },
};
const pp = new PlantingPhase(game, bga);

const freshArgsFromServer = {
    planting_statuses: { 7: 0 },
    hand: {
        501: { id: 501, type: 'Cattus' },
        502: { id: 502, type: 'Cutetus' },
        503: { id: 503, type: 'Battus' }, // the just-drawn card, missing from the stale cache
    },
};

pp.onEnteringState(freshArgsFromServer, true);
check('gamedatas.hand resynced from args, including the just-drawn card (503)',
    Object.keys(game.gamedatas.hand).sort().join(',') === '501,502,503',
    game.gamedatas.hand);
check('renderHand() was explicitly called with the fresh hand (not left for the notification to eventually do)',
    renderHandCalls.length > 0 && Object.keys(renderHandCalls[renderHandCalls.length - 1].hand).includes('503'),
    renderHandCalls);

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
