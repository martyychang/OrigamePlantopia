<?php
declare(strict_types=1);

/**
 * Regression test for the REAL cause of the planting "server error" cluster
 * (Trello TuFvhs3g; BGA #245224 et al.), pinned by Marty's repro 2026-09-26:
 * it happens specifically when a player has claimed the **Tomato** character.
 *
 * Root cause: PlantCards::getFamily() match()'d its argument against the
 * plant_type constants (baby_cactus/…) with NO default arm, but the Tomato
 * character's plant-time hook — PlantingPhase::queueCharacterPlantingEffects()
 * — passes the planted card's raw `type`, which is the card NAME (e.g.
 * 'Cutetus'), not a plant_type. A card name fell through to an uncaught
 * \UnhandledMatchError → BGA's generic red "server error", on the FIRST plant
 * of the game for a Tomato player.
 *
 * Note this is a DIFFERENT bug from the persisted-enum fragility hardened in
 * v2.0.2 (PlantingPhase::substateOf tryFrom + guarded decode). That hardening
 * was real but did not touch this path — getFamily() is why the live reports
 * happened. Fixed by making getFamily() resolve card-name-or-plant-type via
 * resolvePlantType() (like isBaby()/isTreevolved()) with a loud default arm.
 *
 * Drives the REAL PlantCards.php / PlantingPhase.php against harness.php.
 * Run: php tests/php/TomatoPlantingCrashTest.php
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
    echo ($cond ? "  ok  — $label\n" : ("  FAIL — $label" . ($detail ? " ($detail)" : '') . "\n"));
    if (!$cond) $failures++;
}

Game::$PLANT_CARD_TYPES = PlantCards::getTypes();

// ── 1. getFamily() accepts a card NAME (what the Tomato hook passes) ──
echo "--- getFamily() resolves card names, not just plant_types ---\n";
check("getFamily('Cutetus') (card name) === 'cactus'", PlantCards::getFamily('Cutetus') === 'cactus');
check("getFamily('Buttercup') (card name) === 'flower'", PlantCards::getFamily('Buttercup') === 'flower');
check("getFamily('baby_cactus') (plant_type) still === 'cactus'", PlantCards::getFamily('baby_cactus') === 'cactus');
check("getFamily('trv_tree') (plant_type) === 'tree'", PlantCards::getFamily('trv_tree') === 'tree');
$threwClean = false;
try { PlantCards::getFamily('NotARealThing'); }
catch (\InvalidArgumentException $e) { $threwClean = true; }
catch (\Throwable $e) { $threwClean = false; }
check("getFamily(garbage) throws a clean \\InvalidArgumentException (not \\UnhandledMatchError)", $threwClean);

// ── 2. Integration: a Tomato player planting a Baby must NOT server-error ──
echo "--- planting a Baby as the Tomato character no longer crashes ---\n";
$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_pending_effects' => '[]', 'player_planting_status' => '0', 'player_banana_used' => 0];
$game->currentPlayerId = 1;
$game->plantCards->seed('Cutetus', 0, 'deck', 0, 40);
[$plantId] = $game->plantCards->seed('Cutetus', 0, 'hand', 1, 1);            // Baby, cost 1
[$payId]   = $game->plantCards->seed('Pointless Cactus', 0, 'hand', 1, 1);   // discardable hand card
[$planterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);
$game->characterCards->seed('tomato', 0, 'garden', 1, 1);                     // <-- Tomato claimed

$state = new PlantingPhase($game);
$state->bga = new BgaStub();

$crash = null;
try {
    $state->actPlant($plantId, $planterId, (string)$payId);
} catch (\Throwable $e) {
    $crash = get_class($e) . ': ' . $e->getMessage();
}
check('actPlant(Baby) as Tomato does not throw (was \\UnhandledMatchError)', $crash === null, (string)$crash);
check('the Baby actually got planted', $game->plantCards->getCard($plantId)['location'] === 'planter');
check('the payment card was discarded', $game->plantCards->getCard($payId)['location'] === 'discard');

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
