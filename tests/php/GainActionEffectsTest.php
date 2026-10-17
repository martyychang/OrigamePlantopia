<?php
declare(strict_types=1);

/**
 * Systematic card-by-card audit (Marty's request): functional coverage
 * for 'gain_action' ("immediately carry out a Planting Phase action"),
 * which had no test coverage before this audit. Covers:
 *   - Captus:    gain_action + draw_cards (both auto-resolve; no prompt)
 *   - Arrowhead: gain_action + level_up=ANY with effect_priority deferring
 *                the grow — RULEBOOK ORDER: the granted Planting Phase action
 *                resolves FIRST, and the grow is deferred until after it (and
 *                anything it spawns) fully resolve (trello.com/c/vJ4qfqoR).
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

// ── Arrowhead: gain_action + level_up(ANY) — RULEBOOK ORDER ────────────
// Action first (gain_action), grow deferred until after the granted action.
echo "\n--- Arrowhead (gain_action FIRST, grow deferred) ---\n";
$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_pending_effects' => '[]', 'player_deferred_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
$game->currentPlayerId = 1;
$game->plantCards->seed('Buttercup', 0, 'deck', 0, 40);
[$growTargetId] = $game->plantCards->seed('Cutetus', 0, 'planter', 0, 1);
[$growTargetPlanterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
$game->plantCards->cards[$growTargetId]['location_arg'] = $growTargetPlanterId;
// Arrowhead costs 2 Baby Flower sacrificed (a level-2 Buttercup).
[$sacA] = $game->plantCards->seed('Buttercup', 0, 'planter', 0, 1);
[$sacAPlanterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
$game->plantCards->cards[$sacA]['location_arg'] = $sacAPlanterId;
$game->plantCards->cards[$sacA]['type_arg'] = 2;
[$arrowheadId] = $game->plantCards->seed('Arrowhead', 0, 'hand', 1, 1);
[$arrowheadPlanterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
// For the granted Planting Phase action: a plain Buttercup to plant (baby,
// cost 2 cards) + 2 payment cards in hand + a free planter.
[$grantedButtercupId] = $game->plantCards->seed('Buttercup', 0, 'hand', 1, 1);
[$pay1, $pay2] = $game->plantCards->seed('Buttercup', 0, 'hand', 1, 2);
[$grantedPlanterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);

$bga = new BgaStub();
$state = new PlantingPhase($game);
$state->bga = $bga;
$state->actPlant($arrowheadId, $arrowheadPlanterId, (string)$sacA);

// gain_action fired FIRST → player is Ready for the granted action; the grow
// is parked in the deferred store, main queue empty, grow NOT yet applied.
check('main queue empty — gain_action resolved first, not blocked by the grow', count(json_decode($game->players[1]['player_pending_effects'], true)) === 0, $game->players[1]['player_pending_effects']);
$deferred = json_decode($game->players[1]['player_deferred_effects'], true);
check('grow is deferred (held, not resolved)', count($deferred) === 1 && $deferred[0]['type'] === 'level_up', json_encode($deferred));
check('deferred grow carries source_type for the prompt prefix (Trello XKfMDTCy)', ($deferred[0]['source_type'] ?? null) === 'Arrowhead', json_encode($deferred));
check('player is Ready (0) to take the granted planting action', (int)$game->players[1]['player_planting_status'] === 0);
check('grow target NOT yet leveled (grow waits until after the action)', (int)$game->plantCards->getCard($growTargetId)['type_arg'] === 0);
check('server sent "playerGainedAction"', in_array('playerGainedAction', array_map(fn($e) => $e['name'], $bga->notify->log), true));

// Player takes the granted Planting Phase action: plant a Buttercup. Buttercup
// has its OWN grow effect (level_up ANY, qty 2) — which must resolve BEFORE
// Arrowhead's deferred grow, proving the granted action AND anything it spawns
// come first, exactly as the rulebook order requires.
$state->actPlant($grantedButtercupId, $grantedPlanterId, "$pay1;$pay2");

$q = json_decode($game->players[1]['player_pending_effects'], true);
check("granted Buttercup's OWN grow (qty 2) is what's pending now — resolves first", count($q) === 1 && $q[0]['type'] === 'level_up' && (int)$q[0]['qty'] === 2, json_encode($q));
$deferred = json_decode($game->players[1]['player_deferred_effects'], true);
check("Arrowhead's grow (qty 1) stays deferred while the granted action resolves", count($deferred) === 1 && (int)$deferred[0]['qty'] === 1, json_encode($deferred));

// Resolve the granted Buttercup's grow (qty 2) on the Arrowhead plant.
$state->actResolveLevelUp($arrowheadId);
check("granted action's own grow applied first (Arrowhead +2)", (int)$game->plantCards->getCard($arrowheadId)['type_arg'] === 2);

// NOW the granted action is fully done → Arrowhead's deferred grow is injected.
$q = json_decode($game->players[1]['player_pending_effects'], true);
check("Arrowhead's deferred grow (qty 1) injected only AFTER the granted action", count($q) === 1 && $q[0]['type'] === 'level_up' && (int)$q[0]['qty'] === 1, json_encode($q));
check('deferred store now empty (grow moved into the main queue)', count(json_decode($game->players[1]['player_deferred_effects'], true)) === 0);
check('player is ResolvingEffects (3) — now prompted for the deferred grow', (int)$game->players[1]['player_planting_status'] === 3);

// Resolve Arrowhead's deferred grow (qty 1) on the Cutetus.
$state->actResolveLevelUp($growTargetId);
check('deferred grow applied LAST (Cutetus +1)', (int)$game->plantCards->getCard($growTargetId)['type_arg'] === 1);
check('pending_effects empty after all effects resolve', count(json_decode($game->players[1]['player_pending_effects'], true)) === 0);
check('player marked Done (1) after the full Arrowhead resolution', (int)$game->players[1]['player_planting_status'] === 1);

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
