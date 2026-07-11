<?php
declare(strict_types=1);

/**
 * Systematic card-by-card audit (Marty's request): functional coverage
 * for the 4 distinct level_up effect shapes, none of which had any test
 * coverage before this audit:
 *   - Buttercup:       level_up = LEVEL_UP_ANY,   qty 2 (interactive — player picks any growable plant)
 *   - Natural Flower:  level_up = LEVEL_UP_OTHER, qty 1 (interactive — must NOT be the card just planted)
 *   - Twolips:         level_up = LEVEL_UP_THIS,  qty 2 (auto-resolved — grows itself, no prompt)
 *   - Violet:          level_up_family = true          (interactive — player picks a family, ALL of that
 *                                                        family's plants on planters grow by 1)
 *
 * Drives the REAL PlantCards.php / PlantingPhase.php (unmodified) against
 * the fake BGA framework in harness.php.
 *
 * Run: php tests/php/LevelUpEffectsTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../origameplantopia/modules/php/States/PlantingPlayerSubstate.php';
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

Game::$PLANT_CARD_TYPES = PlantCards::getTypes();

function freshGame(int $playerId): array {
    $game = new Game();
    $game->players[$playerId] = ['name' => "P$playerId", 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
    $game->currentPlayerId = $playerId;
    $game->plantCards->seed('Buttercup', 0, 'deck', 0, 40); // filler for payment costs
    $bga = new BgaStub();
    $state = new PlantingPhase($game);
    $state->bga = $bga;
    return [$game, $state, $bga];
}

// ── Buttercup: LEVEL_UP_ANY, qty 2, interactive ─────────────────────────
echo "--- Buttercup (LEVEL_UP_ANY, qty 2) ---\n";
[$game, $state, $bga] = freshGame(1);
[$targetId] = $game->plantCards->seed('Cutetus', 0, 'planter', 6001, 1); // existing Baby Cactus, level 0
[$targetPlanterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
$game->plantCards->cards[$targetId]['location_arg'] = $targetPlanterId;
[$buttercupId] = $game->plantCards->seed('Buttercup', 0, 'hand', 1, 1); // cost 0, no payment needed
[$buttercupPlanterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);

$state->actPlant($buttercupId, $buttercupPlanterId, '');
$queue = json_decode($game->players[1]['player_pending_effects'], true);
check('Buttercup queues exactly 1 interactive level_up effect', count($queue) === 1 && $queue[0]['type'] === 'level_up', json_encode($queue));
check('effect targets LEVEL_UP_ANY with qty 2', $queue[0]['target'] === PlantCards::LEVEL_UP_ANY && $queue[0]['qty'] === 2);

$state->actResolveLevelUp($targetId);
check('target plant grew from level 0 to level 2 (qty 2)', (int)$game->plantCards->getCard($targetId)['type_arg'] === 2);
check('pending_effects queue is empty after resolving', count(json_decode($game->players[1]['player_pending_effects'], true)) === 0);

// ── Natural Flower: LEVEL_UP_OTHER, qty defaults to 1, interactive ──────
echo "\n--- Natural Flower (LEVEL_UP_OTHER, qty 1) ---\n";
[$game, $state, $bga] = freshGame(1);
[$targetId] = $game->plantCards->seed('Cutetus', 0, 'planter', 6002, 1);
[$targetPlanterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
$game->plantCards->cards[$targetId]['location_arg'] = $targetPlanterId;
[$nfId] = $game->plantCards->seed('Natural Flower', 0, 'hand', 1, 1);
[$nfPlanterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);

$state->actPlant($nfId, $nfPlanterId, '');
$queue = json_decode($game->players[1]['player_pending_effects'], true);
check('Natural Flower queues a level_up:LEVEL_UP_OTHER effect', count($queue) === 1 && $queue[0]['type'] === 'level_up' && $queue[0]['target'] === PlantCards::LEVEL_UP_OTHER);
check('qty defaults to 1 when level_up_qty is not set on the card', $queue[0]['qty'] === 1, json_encode($queue[0]));

$threw = false;
try {
    $state->actResolveLevelUp($nfId); // trying to grow the SOURCE card itself — must be rejected
} catch (\Bga\GameFramework\UserException $e) {
    $threw = true;
}
check('growing the just-planted source card itself is rejected (must be an OTHER plant)', $threw);

$state->actResolveLevelUp($targetId);
check('a different plant grew by 1 level', (int)$game->plantCards->getCard($targetId)['type_arg'] === 1);

// ── Twolips: LEVEL_UP_THIS, qty 2, AUTO-resolved (no player action) ─────
echo "\n--- Twolips (LEVEL_UP_THIS, qty 2, auto-resolved) ---\n";
[$game, $state, $bga] = freshGame(1);
[$twolipsId] = $game->plantCards->seed('Twolips', 0, 'hand', 1, 1);
[$twolipsPlanterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);

$state->actPlant($twolipsId, $twolipsPlanterId, '');
check('pending_effects queue is empty immediately — LEVEL_UP_THIS needs no player input', count(json_decode($game->players[1]['player_pending_effects'], true)) === 0);
check('Twolips grew itself from level 0 to level 2 automatically', (int)$game->plantCards->getCard($twolipsId)['type_arg'] === 2);

// ── Violet: level_up_family, interactive, grows ALL of a chosen family ──
echo "\n--- Violet (level_up_family, grows a whole chosen family) ---\n";
[$game, $state, $bga] = freshGame(1);
// Two Baby Cactus plants (should both grow when 'cactus' is chosen) + one Baby Flower (should NOT grow).
[$cactusA] = $game->plantCards->seed('Cutetus', 0, 'planter', 6003, 1);
[$planterA] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
$game->plantCards->cards[$cactusA]['location_arg'] = $planterA;
[$cactusB] = $game->plantCards->seed('Cutetus', 1, 'planter', 6004, 1);
[$planterB] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
$game->plantCards->cards[$cactusB]['location_arg'] = $planterB;
[$flowerC] = $game->plantCards->seed('Buttercup', 0, 'planter', 6005, 1);
[$planterC] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
$game->plantCards->cards[$flowerC]['location_arg'] = $planterC;

[$violetId] = $game->plantCards->seed('Violet', 0, 'hand', 1, 1);
$paymentIds = $game->plantCards->pickCards(2, 'deck', 1); // Violet costs 2 cards
[$violetPlanterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);

$state->actPlant($violetId, $violetPlanterId, implode(';', array_keys($paymentIds)));
$queue = json_decode($game->players[1]['player_pending_effects'], true);
check('Violet queues a level_up_family effect', count($queue) === 1 && $queue[0]['type'] === 'level_up_family');

$threwOnWrongAction = false;
try {
    $state->actResolveLevelUp($cactusA); // wrong action for a level_up_family effect — must be rejected
} catch (\Bga\GameFramework\UserException $e) {
    $threwOnWrongAction = true;
}
check('actResolveLevelUp (single-plant) rejects a pending level_up_family effect', $threwOnWrongAction);
check('rejecting the wrong action did not grow anything', (int)$game->plantCards->getCard($cactusA)['type_arg'] === 0);

$state->actResolveLevelUpFamily('cactus');
check('cactus plant A (level 0) grew to level 1', (int)$game->plantCards->getCard($cactusA)['type_arg'] === 1);
check('cactus plant B (level 1) grew to level 2', (int)$game->plantCards->getCard($cactusB)['type_arg'] === 2);
check('the flower plant did NOT grow (family filter works)', (int)$game->plantCards->getCard($flowerC)['type_arg'] === 0);
check('pending_effects queue is empty after resolving', count(json_decode($game->players[1]['player_pending_effects'], true)) === 0);

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
