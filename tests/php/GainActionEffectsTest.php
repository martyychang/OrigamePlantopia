<?php
declare(strict_types=1);

/**
 * Systematic card-by-card audit (Marty's request): functional coverage
 * for 'gain_action' ("immediately carry out a Planting Phase action"),
 * which had no test coverage before this audit. Covers:
 *   - Captus:    gain_action + draw_cards (both auto-resolve; no prompt)
 *   - Arrowhead: gain_action + level_up=ANY (level_up is interactive —
 *                gain_action must NOT resolve until the player resolves
 *                the level_up first, since it's queued ahead of it)
 *
 * Drives the REAL PlantCards.php / PlantingPhase.php (unmodified) against
 * the fake BGA framework in harness.php.
 *
 * Run: php tests/php/GainActionEffectsTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../plantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../plantopia/modules/php/PlantingPlayerSubstate.php';
require __DIR__ . '/../../plantopia/modules/php/States/PlantingPhase.php';

use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\PlantCards;
use Bga\Games\Plantopia\States\PlantingPhase;
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

// ── Captus: gain_action + draw_cards(2), both auto-resolve ─────────────
echo "--- Captus (gain_action + draw_cards) ---\n";
$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
$game->currentPlayerId = 1;
$game->plantCards->seed('Buttercup', 0, 'deck', 0, 40);
// Captus costs a level-2+ Baby Cactus sacrificed from the garden (Treevolved cost_unit).
[$sacrificeId] = $game->plantCards->seed('Cutetus', 2, 'planter', 0, 1);
[$sacrificePlanterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
$game->plantCards->cards[$sacrificeId]['location_arg'] = $sacrificePlanterId;
[$captusId] = $game->plantCards->seed('Captus', 0, 'hand', 1, 1);
[$captusPlanterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);

$bga = new BgaStub();
$state = new PlantingPhase($game);
$state->bga = $bga;
$state->actPlant($captusId, $captusPlanterId, (string)$sacrificeId);

$hand = $game->plantCards->getCardsInLocation('hand', 1);
check('drew 2 cards from Captus\'s draw_cards effect', count($hand) === 2, 'hand=' . count($hand));
check('pending_effects queue is empty (both draw_cards and gain_action auto-resolved)', count(json_decode($game->players[1]['player_pending_effects'], true)) === 0);
check('player_planting_status reset to 0 — gain_action grants another action', (int)$game->players[1]['player_planting_status'] === 0);

$notifNames = array_map(fn($e) => $e['name'], $bga->notify->log);
check('server sent "playerGainedAction"', in_array('playerGainedAction', $notifNames, true), json_encode($notifNames));

// ── Arrowhead: gain_action + level_up(ANY) — gain_action waits its turn ─
echo "\n--- Arrowhead (gain_action + level_up=ANY, interactive) ---\n";
$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
$game->currentPlayerId = 1;
$game->plantCards->seed('Buttercup', 0, 'deck', 0, 40);
[$growTargetId] = $game->plantCards->seed('Cutetus', 0, 'planter', 0, 1);
[$growTargetPlanterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
$game->plantCards->cards[$growTargetId]['location_arg'] = $growTargetPlanterId;
// Arrowhead costs 2 Baby Flower sacrificed.
[$sacA] = $game->plantCards->seed('Buttercup', 0, 'planter', 0, 1);
[$sacAPlanterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
$game->plantCards->cards[$sacA]['location_arg'] = $sacAPlanterId;
$game->plantCards->cards[$sacA]['type_arg'] = 2; // must meet Arrowhead's min level requirement (cost=2)
[$arrowheadId] = $game->plantCards->seed('Arrowhead', 0, 'hand', 1, 1);
[$arrowheadPlanterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);

$bga = new BgaStub();
$state = new PlantingPhase($game);
$state->bga = $bga;
$state->actPlant($arrowheadId, $arrowheadPlanterId, (string)$sacA);

$queue = json_decode($game->players[1]['player_pending_effects'], true);
check(
    'gain_action stays queued behind the still-unresolved level_up (does not fire early)',
    count($queue) === 2 && $queue[0]['type'] === 'level_up' && $queue[1]['type'] === 'gain_action',
    json_encode($queue)
);
check('player_planting_status is 3 (resolving_effects) — action not yet granted', (int)$game->players[1]['player_planting_status'] === 3);

$state->actResolveLevelUp($growTargetId);
check('grow target leveled up by 1', (int)$game->plantCards->getCard($growTargetId)['type_arg'] === 1);
check('pending_effects queue is now empty (gain_action resolved right after)', count(json_decode($game->players[1]['player_pending_effects'], true)) === 0);
check('player_planting_status reset to 0 after gain_action finally resolves', (int)$game->players[1]['player_planting_status'] === 0);

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
