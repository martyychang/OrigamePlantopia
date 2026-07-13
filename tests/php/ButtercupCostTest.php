<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/2CxvEj22
 * "Buttercup was planted for free instead of costing two cards"
 *
 * Root cause: PlantCards.php's Buttercup entry had 'cost' => 0. This was a
 * pure data error, not a validation-logic bug — actPlant()'s cost check
 * (`count($paymentCardIds) !== $cost`) is correct and was simply enforcing
 * whatever the data said, so a real player COULD legitimately plant
 * Buttercup with zero payment cards, exactly as reported. Buttercup was
 * also the only card in the whole catalog, across every plant family,
 * with a Baby Plant cost of 0.
 *
 * Drives the REAL PlantCards.php / PlantingPhase.php (unmodified) against
 * the fake BGA framework in harness.php.
 *
 * Run: php tests/php/ButtercupCostTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantingPlayerSubstate.php';
require __DIR__ . '/../../origameplantopia/modules/php/States/PlantingPhase.php';

use Bga\Games\OrigamePlantopia\Game;
use Bga\Games\OrigamePlantopia\PlantCards;
use Bga\Games\OrigamePlantopia\States\PlantingPhase;
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

check('Buttercup costs 2 cards in the catalog', PlantCards::getTypes()['Buttercup']['cost'] === 2,
    'cost=' . PlantCards::getTypes()['Buttercup']['cost']);

Game::$PLANT_CARD_TYPES = PlantCards::getTypes();

// ── Planting Buttercup with NO payment must now be rejected ──
echo "--- planting Buttercup for free is rejected ---\n";
$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
$game->currentPlayerId = 1;
$game->plantCards->seed('Cutetus', 0, 'deck', 0, 40);

[$buttercupId] = $game->plantCards->seed('Buttercup', 0, 'hand', 1, 1);
[$planterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);

$bga = new BgaStub();
$state = new PlantingPhase($game);
$state->bga = $bga;

$threw = false;
try {
    $state->actPlant($buttercupId, $planterId, '');
} catch (UserException $e) {
    $threw = true;
}
check('actPlant(Buttercup, no payment) is rejected', $threw);
check('Buttercup is still in hand, not planted', $game->plantCards->getCard($buttercupId)['location'] === 'hand');
check('the planter is still empty', count($game->plantCards->getCardsInLocation('planter', $planterId)) === 0);

// ── Planting Buttercup with exactly 1 payment card must also be rejected (wrong count) ──
$fillerIds = $game->plantCards->getCardsInLocation('deck', 0);
$oneCardId = array_key_first($fillerIds);
$threwOne = false;
try {
    $state->actPlant($buttercupId, $planterId, (string)$oneCardId);
} catch (UserException $e) {
    $threwOne = true;
}
check('actPlant(Buttercup, only 1 payment card) is also rejected — cost is exactly 2', $threwOne);

// ── Planting Buttercup with the correct 2 payment cards succeeds ──
echo "\n--- planting Buttercup with the correct 2-card payment succeeds ---\n";
$payment = $game->plantCards->pickCards(2, 'deck', 1);
$state->actPlant($buttercupId, $planterId, implode(';', array_keys($payment)));

check('Buttercup is now planted (on the planter)', $game->plantCards->getCard($buttercupId)['location'] === 'planter');
check('both payment cards were discarded', array_reduce(
    array_keys($payment),
    fn($carry, $id) => $carry && $game->plantCards->getCard($id)['location'] === 'discard',
    true
));

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
