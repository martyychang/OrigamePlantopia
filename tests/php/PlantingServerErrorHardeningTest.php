<?php
declare(strict_types=1);

/**
 * Regression test for the "discard-to-pay throws a generic server error"
 * cluster — Trello TuFvhs3g, BGA table reports #240245 / #240541 / #240860
 * / #240892 / #244040 / #245224.
 *
 * The reported symptom is BGA's generic red "server error" bar (NOT one of
 * our clean UserException rejection messages) when a player tries to plant.
 * A generic server error means actPlant hit an *uncaught* Throwable — a PHP
 * fatal — rather than validating-and-rejecting. Two fragile spots on the
 * planting hot path can do exactly that:
 *
 *   1. substateOf() reads player_planting_status via
 *      PlantingPlayerSubstate::from((int)$db). PHP's enum ::from() throws an
 *      uncaught \ValueError on ANY backing value that isn't a declared case
 *      (this enum's are 0/1/3 — 2 is deliberately skipped). requireReadyForNewAction()
 *      calls this as the FIRST thing actPlant does, so a single off-enum
 *      value in that one player's column turns every plant/grow/draw attempt
 *      into a server error — matching report #244040 ("happens every time,
 *      only me, other players are fine": it's a per-player column).
 *
 *   2. processPendingEffects()/queueEffects() do count(json_decode($col,true)).
 *      json_decode() of a malformed or non-array JSON string returns null,
 *      and count(null) is a \TypeError on PHP 8+ (BGA runs 8.x).
 *
 * A fresh game never writes an off-enum status today, but BGA tables are
 * long-lived and these substate columns/enums were refactored more than
 * once (Trello tasks: split bonus-weather onto its own column, move enums
 * out of States/) — a table in flight across such a change, or any future
 * off-by-one, resurfaces as an unrecoverable server error with no clean
 * message. The fix is to make every persisted-state read fail SAFE
 * (tryFrom + a sane default; guarded decode) so a corrupt value degrades to
 * a normal/queued state instead of fatally crashing the action.
 *
 * Drives the REAL PlantingPhase.php / PlantCards.php (unmodified) against
 * the fake BGA framework in harness.php.
 *
 * Run: php tests/php/PlantingServerErrorHardeningTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../plantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../plantopia/modules/php/PlantingPlayerSubstate.php';
require __DIR__ . '/../../plantopia/modules/php/States/PlantingPhase.php';

use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\PlantCards;
use Bga\Games\Plantopia\States\PlantingPhase;
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

/** Build a player with one Cutetus (cost 1) in hand + a filler card + an empty planter. */
function freshPlantScenario(string $plantingStatus, string $pendingEffects): array {
    $game = new Game();
    $game->players[1] = [
        'name' => 'Alice',
        'player_pending_effects' => $pendingEffects,
        'player_planting_status' => $plantingStatus,
        'player_banana_used' => 0,
    ];
    $game->currentPlayerId = 1;
    // Stock the deck so any post-plant draw effect can resolve.
    $game->plantCards->seed('Cutetus', 0, 'deck', 0, 40);
    [$plantId] = $game->plantCards->seed('Cutetus', 0, 'hand', 1, 1);      // Cutetus: baby, cost 1
    [$payId]   = $game->plantCards->seed('Pointless Cactus', 0, 'hand', 1, 1); // a discardable hand card
    [$planterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);

    $state = new PlantingPhase($game);
    $state->bga = new BgaStub();
    return [$state, $plantId, $payId, $planterId, $game];
}

// ─────────────────────────────────────────────────────────────────────────
echo "--- 1. off-enum player_planting_status must NOT crash actPlant with a raw \\ValueError ---\n";
// '2' is a valid INT for the column but has NO enum case (cases are 0/1/3).
[$state, $plantId, $payId, $planterId, $game] = freshPlantScenario('2', '[]');
$threw = null;
try {
    $state->actPlant($plantId, $planterId, (string)$payId);
} catch (\ValueError $e) {
    $threw = 'ValueError'; // the bug: uncaught fatal -> BGA "server error"
} catch (UserException $e) {
    $threw = 'UserException'; // acceptable: clean rejection the player can read
} catch (\Throwable $e) {
    $threw = get_class($e) . ': ' . $e->getMessage();
}
check('actPlant with off-enum status does not raise a raw \\ValueError (BGA "server error")',
    $threw !== 'ValueError', 'got ' . var_export($threw, true));

// ─────────────────────────────────────────────────────────────────────────
echo "--- 2. a Ready player plants normally by discarding to pay (happy path still works) ---\n";
[$state, $plantId, $payId, $planterId, $game] = freshPlantScenario('0', '[]');
$ok = true; $err = '';
try {
    $state->actPlant($plantId, $planterId, (string)$payId);
} catch (\Throwable $e) {
    $ok = false; $err = get_class($e) . ': ' . $e->getMessage();
}
check('actPlant(Cutetus, 1 discard) succeeds for a Ready player', $ok, $err);
check('Cutetus is now on the planter', $game->plantCards->getCard($plantId)['location'] === 'planter');
check('the payment card was discarded', $game->plantCards->getCard($payId)['location'] === 'discard');

// ─────────────────────────────────────────────────────────────────────────
echo "--- 3. malformed player_pending_effects JSON must NOT crash with a raw \\TypeError ---\n";
// 'null' decodes to null; count(null) is a TypeError on PHP 8. Any legacy/
// corrupt value in this column should degrade to "no pending effects".
[$state, $plantId, $payId, $planterId, $game] = freshPlantScenario('0', 'null');
$threw = null;
try {
    $state->actPlant($plantId, $planterId, (string)$payId);
} catch (\TypeError $e) {
    $threw = 'TypeError'; // the bug
} catch (UserException $e) {
    $threw = 'UserException';
} catch (\Throwable $e) {
    $threw = get_class($e) . ': ' . $e->getMessage();
}
check('actPlant with malformed pending-effects JSON does not raise a raw \\TypeError',
    $threw !== 'TypeError', 'got ' . var_export($threw, true));

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
