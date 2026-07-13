<?php
declare(strict_types=1);

/**
 * Regression test for a bug found while documenting the player-substate
 * pattern (see "Player substates — pattern & rules" in the BGA Studio
 * State Machine doc): PlantingPhase::checkActionAllowed() only rejected a
 * player whose substate was Done — it did NOT reject ResolvingEffects, so
 * a player could start a brand-new top-level action (actPlant / actGrow /
 * actRequestDraw5) while their PREVIOUS action's interactive effect (e.g.
 * an unresolved level_up choice) was still pending. The second action
 * would succeed, consuming a planter/payment/sacrifice, and its own
 * effects would get silently appended onto the SAME pending_effects queue
 * as the still-unresolved first effect.
 *
 * Fixed by requireReadyForNewAction(), a stricter guard (Ready only) used
 * by the three "start something brand new" actions, while the resolve-*
 * actions keep the original, looser checkActionAllowed() (they're the
 * intended way OUT of ResolvingEffects, so they must not be blocked by it).
 *
 * Run: php tests/php/PlayerSubstateGuardTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantingPlayerSubstate.php';
require __DIR__ . '/../../origameplantopia/modules/php/States/PlantingPhase.php';

use Bga\Games\OrigamePlantopia\Game;
use Bga\Games\OrigamePlantopia\PlantCards;
use Bga\Games\OrigamePlantopia\States\PlantingPhase;
use Bga\Games\OrigamePlantopia\PlantingPlayerSubstate;
use Bga\GameFramework\BgaStub;
use Bga\GameFramework\UserException;

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

Game::$PLANT_CARD_TYPES = PlantCards::getTypes();

function freshGame(int $playerId): array {
    $game = new Game();
    $game->players[$playerId] = ['name' => "P$playerId", 'player_pending_effects' => '[]', 'player_planting_status' => PlantingPlayerSubstate::Ready->value, 'player_banana_used' => 0];
    $game->currentPlayerId = $playerId;
    $game->plantCards->seed('Buttercup', 0, 'deck', 0, 40);
    $bga = new BgaStub();
    $state = new PlantingPhase($game);
    $state->bga = $bga;
    return [$game, $state, $bga];
}

// ── The bug: actPlant used to succeed a second time mid-ResolvingEffects ──
echo "--- actPlant is rejected while a previous effect is still unresolved ---\n";
[$game, $state, $bga] = freshGame(1);
[$targetId] = $game->plantCards->seed('Cutetus', 0, 'planter', 0, 1);
[$targetPlanterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
$game->plantCards->cards[$targetId]['location_arg'] = $targetPlanterId;

[$buttercupId] = $game->plantCards->seed('Buttercup', 0, 'hand', 1, 1); // queues an interactive level_up
[$planterA] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
$buttercupPayment = $game->plantCards->pickCards(2, 'deck', 1); // Buttercup costs 2 cards — see https://trello.com/c/2CxvEj22
$state->actPlant($buttercupId, $planterA, implode(';', array_keys($buttercupPayment)));

check(
    'planting Buttercup leaves the player ResolvingEffects (interactive level_up pending)',
    (int)$game->players[1]['player_planting_status'] === PlantingPlayerSubstate::ResolvingEffects->value
);

[$secondCardId] = $game->plantCards->seed('Cutetus', 0, 'hand', 1, 1);
$payment = $game->plantCards->pickCards(1, 'deck', 1);
[$planterB] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);

$threw = false;
try {
    $state->actPlant($secondCardId, $planterB, (string)array_key_first($payment));
} catch (UserException $e) {
    $threw = true;
}
check('a second actPlant() while ResolvingEffects is now rejected', $threw);
check('the second card was NOT planted', $game->plantCards->getCard($secondCardId)['location'] === 'hand');
check('the second planter is still empty', count($game->plantCards->getCardsInLocation('planter', $planterB)) === 0);

$queue = json_decode($game->players[1]['player_pending_effects'], true);
check('the pending_effects queue still holds only the FIRST card\'s effect (no cross-contamination)', count($queue) === 1 && $queue[0]['type'] === 'level_up', json_encode($queue));

// ── Same guard applies to actGrow and actRequestDraw5 ──
echo "\n--- actGrow and actRequestDraw5 are rejected the same way ---\n";
$threwGrow = false;
try {
    $state->actGrow($targetId, '');
} catch (UserException $e) {
    $threwGrow = true;
}
check('actGrow() while ResolvingEffects is rejected', $threwGrow);

$threwDraw5 = false;
try {
    $state->actRequestDraw5();
} catch (UserException $e) {
    $threwDraw5 = true;
}
check('actRequestDraw5() while ResolvingEffects is rejected', $threwDraw5);

// ── Resolving the pending effect is NOT blocked by the same guard ──
echo "\n--- resolving the pending effect still works (the guard doesn't lock the player out) ---\n";
$state->actResolveLevelUp($targetId);
check('resolving the level_up succeeds (Buttercup grows the target by 2 levels)', (int)$game->plantCards->getCard($targetId)['type_arg'] === 2);
check('player is Done after resolving (no more pending effects)', (int)$game->players[1]['player_planting_status'] === PlantingPlayerSubstate::Done->value);

// ── Once Done, a new top-level action is correctly rejected too (pre-existing behavior) ──
echo "\n--- a Done player still can't start a new action either ---\n";
[$thirdCardId] = $game->plantCards->seed('Cutetus', 0, 'hand', 1, 1);
$payment2 = $game->plantCards->pickCards(1, 'deck', 1);
[$planterC] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
$threwDone = false;
try {
    $state->actPlant($thirdCardId, $planterC, (string)array_key_first($payment2));
} catch (UserException $e) {
    $threwDone = true;
}
check('actPlant() after Done is rejected', $threwDone);

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
