<?php
declare(strict_types=1);

/**
 * Reproduction harness for https://trello.com/c/T2R4Njk5
 * "Bug: Planting Cattus draws 5 cards but player does not discard"
 *
 * Loads the REAL PlantCards.php and PlantingPhase.php (unmodified) against
 * the fake BGA framework in harness.php, and drives the exact server-side
 * sequence a client triggers when planting Cattus:
 *   1. actPlant(cardId=<Cattus>, planterCardId=<planter>, paymentCardIds="<payCard>")
 *      -> pays 1 card, plants Cattus, queues 'draft_cards' (draw 5, keep 1)
 *      -> processPendingEffects draws 5 into 'draft', notifies, PAUSES
 *   2. actResolveDraft(cardIdsStr="<one kept card id>")
 *      -> should move 1 card to hand, the other 4 to discard, clear the queue
 *
 * Run: php tests/php/CattusDraftTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../origameplantopia/modules/php/States/PlantingPhase.php';

use Bga\Games\OrigamePlantopia\Game;
use Bga\Games\OrigamePlantopia\PlantCards;
use Bga\Games\OrigamePlantopia\States\PlantingPhase;
use Bga\GameFramework\BgaStub;

$failures = 0;
function check(string $label, bool $cond, string $detail = ''): void {
    global $failures;
    if ($cond) {
        echo "  ok  — $label\n";
    } else {
        echo "  FAIL — $label" . ($detail ? " ($detail)" : '') . "\n";
        $failures++;
    }
}

// ── Arrange ──────────────────────────────────────────────────────────────
Game::$PLANT_CARD_TYPES = PlantCards::getTypes();

$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
$game->currentPlayerId = 1;

// Seed the deck: 40 filler cards of a cheap type ("Buttercup", cost 0) so
// draws never run dry, plus 1 Cattus card in the player's hand to plant,
// and 1 more filler card in hand to use as the Cattus planting cost (cost=1).
$fillerIds = $game->plantCards->seed('Buttercup', 0, 'deck', 0, 40);
[$cattusId] = $game->plantCards->seed('Cattus', 0, 'hand', 1, 1);
$game->plantCards->moveCard($fillerIds[0], 'hand', 1); // payment card for Cattus's cost
$paymentCardId = $fillerIds[0];

[$planterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);

$bga = new BgaStub();
$state = new PlantingPhase($game);
$state->bga = $bga;

// ── Act: plant Cattus, paying with $paymentCardId ───────────────────────
$state->actPlant($cattusId, $planterId, (string)$paymentCardId);

echo "--- After actPlant (Cattus planted, draft_cards effect should have fired) ---\n";
$queueAfterPlant = json_decode($game->players[1]['player_pending_effects'], true);
check('pending_effects queue has exactly 1 entry', count($queueAfterPlant) === 1, json_encode($queueAfterPlant));
check('pending effect is draft_cards', ($queueAfterPlant[0]['type'] ?? null) === 'draft_cards');
check('draft_cards draw=5', ($queueAfterPlant[0]['draw'] ?? null) === 5);
check('draft_cards keep=1', ($queueAfterPlant[0]['keep'] ?? null) === 1);

$draftCards = $game->plantCards->getCardsInLocation('draft', 1);
check('exactly 5 cards moved into the draft zone', count($draftCards) === 5, 'count=' . count($draftCards));

check('payment card discarded', $game->plantCards->getCard($paymentCardId)['location'] === 'discard');
check('Cattus card is now on the planter', $game->plantCards->getCard($cattusId)['location'] === 'planter');

check('player_planting_status set to 3 (resolving_effects)', (int)($game->players[1]['player_planting_status'] ?? -1) === 3);

$notifNames = array_map(fn($e) => $e['name'], $bga->notify->log);
check('server sent a "draftCards" notification with the 5 drawn cards', in_array('draftCards', $notifNames, true));
check('server sent a "pendingEffects" notification', in_array('pendingEffects', $notifNames, true));

// ── Act: resolve the draft — keep exactly 1 of the 5 ────────────────────
$keepId = array_key_first($draftCards);
$bga->notify->log = []; // reset log to isolate this step's notifications
$state->actResolveDraft((string)$keepId);

echo "\n--- After actResolveDraft (kept 1, should discard the other 4) ---\n";
check('kept card moved to hand', $game->plantCards->getCard($keepId)['location'] === 'hand', $game->plantCards->getCard($keepId)['location']);

$discardedCount = 0;
foreach ($draftCards as $id => $c) {
    if ($id === $keepId) continue;
    $loc = $game->plantCards->getCard($id)['location'];
    if ($loc === 'discard') $discardedCount++;
}
check('the other 4 drafted cards were moved to discard', $discardedCount === 4, "discarded=$discardedCount");

check('draft zone is now empty', count($game->plantCards->getCardsInLocation('draft', 1)) === 0);

$finalQueue = json_decode($game->players[1]['player_pending_effects'], true);
check('pending_effects queue is empty after resolving', count($finalQueue) === 0, json_encode($finalQueue));

$notifNames2 = array_map(fn($e) => $e['name'], $bga->notify->log);
check('server sent "keptCards" notification (private, to the player)', in_array('keptCards', $notifNames2, true));
check('server sent "playerKeptDraft" notification (public)', in_array('playerKeptDraft', $notifNames2, true));

$keptCardsNotif = array_values(array_filter($bga->notify->log, fn($e) => $e['name'] === 'keptCards'))[0] ?? null;
check('keptCards notification payload contains exactly 1 card', $keptCardsNotif && count($keptCardsNotif['args']['cards']) === 1);

check('player_planting_status ended at 1 (done) — no character claimed, no gain_action pending',
    (int)($game->players[1]['player_planting_status'] ?? -1) === 1);

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED ($" . 0 . " failures)\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
