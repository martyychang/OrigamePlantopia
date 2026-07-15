/**
 * Regression test for https://trello.com/c/vjsQX06a (2nd bug in that
 * thread, after the numeric-string fix in af2c3f8):
 *
 * Drawing a card fires TWO notifications for the same event —
 * notif_cardsDrawn (private, notify->player, sent only to the drawer,
 * carries the actual card data) and notif_playerDrewCard (public,
 * notify->all, sent to every client including the drawer's own). Both
 * used to increment gamedatas.handCounts by the drawn quantity, so the
 * drawer's OWN client double-counted its own draw (every other client
 * only received the public notif, so only they stayed correct) — e.g.
 * Potato's 10-card hand became 12 instead of 11 after drawing 1.
 *
 * Fixed by making notif_playerDrewCard the single point of truth for
 * handCounts (mirroring the existing notif_keptCards / notif_playerKeptDraft
 * pattern already in Game.js) and having notif_cardsDrawn only touch
 * `hand` + rendering.
 *
 * Same extraction approach as computePlayerStats.test.mjs: pull the real
 * method bodies out of Game.js so this exercises production code, not a
 * re-implementation.
 *
 * Run: node tests/handCountsDrawn.test.mjs
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../plantopia/modules/js/Game.js', import.meta.url), 'utf8');
function extractMethod(name) {
    // notif_ handlers are declared `async <name>(args) {`, unlike the plain
    // `<name>(args) {` computePlayerStats uses — allow an optional `async `.
    const re = new RegExp(`\\n    (?:async )?${name}\\([^)]*\\)\\s*\\{\\n([\\s\\S]*?)\\n    \\}`, 'm');
    const m = src.match(re);
    if (!m) throw new Error(`extractMethod failed for ${name}`);
    return m[1];
}

function buildGame(gamedatas, currentPlayerId) {
    const game = {
        gamedatas,
        bga: { players: { getCurrentPlayerId: () => currentPlayerId } },
        renderHand() {},
        refreshAllPlayerPanels() {},
    };
    game.notif_cardsDrawn = new Function('args', extractMethod('notif_cardsDrawn')).bind(game);
    game.notif_playerDrewCard = new Function('args', extractMethod('notif_playerDrewCard')).bind(game);
    return game;
}

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ok  — ${name}`); passed++; }
    catch (e) { console.error(`  FAIL — ${name}\n    ${e.message}`); failed++; }
}

t('drawer\'s own client: both notifs for one draw increment handCounts by 1, not 2', () => {
    const game = buildGame({ hand: {}, handCounts: { 1: 10 } }, 1);
    // Same order the server sends them: private cardsDrawn, then public playerDrewCard.
    game.notif_cardsDrawn({ cards: { 501: { id: 501, type: 'Buttercup' } } });
    game.notif_playerDrewCard({ player_id: 1, qty: 1 });
    assert.equal(game.gamedatas.handCounts[1], 11, `expected 11, got ${game.gamedatas.handCounts[1]}`);
});

t('opponent\'s client: only the public notif arrives, count still moves by exactly the qty', () => {
    const game = buildGame({ hand: {}, handCounts: { 1: 10, 2: 6 } }, 2);
    // Player 2's client never receives player 1's private cardsDrawn.
    game.notif_playerDrewCard({ player_id: 1, qty: 1 });
    assert.equal(game.gamedatas.handCounts[1], 11);
    assert.equal(game.gamedatas.handCounts[2], 6, 'unrelated player must be untouched');
});

t('notif_cardsDrawn still updates the private hand object and does not itself touch handCounts', () => {
    const game = buildGame({ hand: {}, handCounts: { 1: 10 } }, 1);
    game.notif_cardsDrawn({ cards: { 501: { id: 501, type: 'Buttercup' } } });
    assert.ok(game.gamedatas.hand[501], 'drawn card should be added to hand');
    assert.equal(game.gamedatas.handCounts[1], 10, 'handCounts must be untouched until playerDrewCard arrives');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
