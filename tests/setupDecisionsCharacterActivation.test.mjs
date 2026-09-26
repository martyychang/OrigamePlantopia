/**
 * Regression test for https://trello.com/c/DhFTEXOU
 * "Bug: player 2 stuck with message '⏳ is making setup decisions'"
 *
 * SetupDecisions is a MULTIPLE_ACTIVE_PLAYER state: both players keep/redraw
 * and (with characters enabled) claim a character in parallel. A claim/return
 * is broadcast to EVERY client via notify->all, so every browser re-runs the
 * SetupDecisions handler to refresh the character panel.
 *
 * The bug: notif_characterClaimed re-ran the handler with
 *   isCurrentPlayerActive = (getCurrentPlayerId() === args.player_id)
 * i.e. "is the local player the one who just claimed". For the SECOND,
 * still-choosing player, that is `false` the instant the FIRST player claims —
 * so her client dropped out of the character-selection UI into the non-active
 * "${actplayer} is making setup decisions" wait screen (blank name, because
 * ${actplayer} is empty in a multiactive state) until a page reload re-derived
 * the real state. notif_characterReturned had the mirror bug: a hardcoded
 * `true`.
 *
 * Fix: both re-run with the LOCAL browser's authoritative multiactive status,
 * this.bga.players.isCurrentPlayerActive().
 *
 * This drives the REAL notif_characterClaimed / notif_characterReturned bodies
 * extracted from Game.js against a fake `this` (Node only, no DOM/Chrome).
 *
 * Run: node tests/setupDecisionsCharacterActivation.test.mjs
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../plantopia/modules/js/Game.js', import.meta.url), 'utf8');

function extractMethod(name) {
    const re = new RegExp(`\\n    (?:async )?${name}\\([^)]*\\)\\s*\\{\\n([\\s\\S]*?)\\n    \\}\\n`, 'm');
    const m = src.match(re);
    if (!m) throw new Error(`extractMethod failed for ${name}`);
    return m[1];
}

const claimedBody = extractMethod('notif_characterClaimed');
const returnedBody = extractMethod('notif_characterReturned');

let failures = 0;
function check(label, cond, detail = '') {
    console.log((cond ? '  ok  — ' : '  FAIL — ') + label + (cond ? '' : ` (${detail})`));
    if (!cond) failures++;
}

// A fake `this` mirroring what the handler touches. LOCAL player is #2 (the
// second, still-choosing player). The CLAIMER in args is #1.
function makeCtx(isActiveReturns) {
    const captured = { called: false, activeArg: undefined };
    return {
        captured,
        ctx: {
            muteMoveSound() {},
            gamedatas: { availableCharacters: { c1: { id: 'c1' } }, claimedCharacters: {} },
            renderCharacters() {},
            renderPlayerPanel() {},
            bga: {
                states: { getCurrentMainStateName: () => 'SetupDecisions' },
                players: {
                    getCurrentPlayerId: () => 2,               // local browser = player 2
                    isCurrentPlayerActive: () => isActiveReturns, // BGA's authoritative flag
                },
            },
            setupDecisions: {
                onEnteringState(args, isActive) {
                    captured.called = true;
                    captured.activeArg = isActive;
                },
            },
        },
    };
}

const run = async (body, ctx, args) => {
    const fn = new Function('args', `return (async () => { ${body} }).call(this, args);`);
    await fn.call(ctx, args);
};

// ── claim: player 1 claims; local player 2 IS still active → must stay active ──
{
    const { ctx, captured } = makeCtx(true);            // framework says P2 still active
    await run(claimedBody, ctx, { card: { id: 'c1' }, player_id: 1 });  // claimer = P1 (!= local P2)
    check('characterClaimed re-runs the handler', captured.called);
    check('P2 stays ACTIVE after P1 claims (was forced false by local===claimer)',
        captured.activeArg === true, `got ${captured.activeArg}`);
}

// ── claim: guard against reintroducing `local === claimer` (would be true here) ──
{
    const { ctx, captured } = makeCtx(false);           // framework says local NOT active
    await run(claimedBody, ctx, { card: { id: 'c1' }, player_id: 2 }); // claimer == local (2)
    check('characterClaimed honors isCurrentPlayerActive()=false even when local IS the claimer',
        captured.activeArg === false, `got ${captured.activeArg} (a local===claimer bug would give true)`);
}

// ── return: must use real active status, not a hardcoded true ──
{
    const { ctx, captured } = makeCtx(false);
    await run(returnedBody, ctx, { card: { id: 'c1' }, player_id: 1 });
    check('characterReturned uses isCurrentPlayerActive() (not hardcoded true)',
        captured.activeArg === false, `got ${captured.activeArg}`);
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
