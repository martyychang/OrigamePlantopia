<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/xGkeMcXO
 * "Planting Treegonometree does not add bonus Rain card to player's hand"
 *
 * Root cause: PlantCards::WEATHER_RAIN is the string 'rain', but bonus
 * weather cards store their condition as WeatherCards::CONDITION_RAIN,
 * the int 1, in their type_arg column — two independently-defined
 * constants for the same three conditions. processPendingEffects's
 * 'gain_weather' handling (and isInteractiveEffectMoot's mootness check)
 * passed the PlantCards string straight into
 * WeatherCards::getCardsOfTypeInLocation(), which matches on type_arg —
 * so the typed lookup always matched zero cards, even with a full bonus
 * market. The effect then silently downgraded to "choose ANY weather
 * card" (an interactive prompt) instead of auto-granting the specific
 * card the plant's card_effect promises.
 *
 * Drives the REAL PlantCards.php / WeatherCards.php / PlantingPhase.php
 * (unmodified) against the fake BGA framework in harness.php.
 *
 * Run: php tests/php/GainWeatherTypeTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../origameplantopia/modules/php/WeatherCards.php';
require __DIR__ . '/../../origameplantopia/modules/php/PlantingPlayerSubstate.php';
require __DIR__ . '/../../origameplantopia/modules/php/States/PlantingPhase.php';

use Bga\Games\OrigamePlantopia\Game;
use Bga\Games\OrigamePlantopia\PlantCards;
use Bga\Games\OrigamePlantopia\WeatherCards;
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

// ── Arrange: Alice plants Treegonometree (gain Bonus Rain + draw 1) ────────
$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
$game->currentPlayerId = 1;

// Full bonus market: 3 sun (type_arg 0), 3 rain (type_arg 1), 3 wind (type_arg 2).
$game->weatherCards->seed('bonus', WeatherCards::CONDITION_SUN, 'bonus_deck', 0, 3);
$game->weatherCards->seed('bonus', WeatherCards::CONDITION_RAIN, 'bonus_deck', 0, 3);
$game->weatherCards->seed('bonus', WeatherCards::CONDITION_WIND, 'bonus_deck', 0, 3);

$fillerIds = $game->plantCards->seed('Buttercup', 0, 'deck', 0, 40);
[$treegonoId] = $game->plantCards->seed('Treegonometree', 0, 'hand', 1, 1);
$game->plantCards->moveCard($fillerIds[0], 'hand', 1); // payment card
$paymentCardId = $fillerIds[0];

[$planterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);

$bga = new BgaStub();
$state = new PlantingPhase($game);
$state->bga = $bga;

// ── Act: plant Treegonometree ───────────────────────────────────────────
$state->actPlant($treegonoId, $planterId, (string)$paymentCardId);

// ── Assert: Alice was auto-granted a Bonus Rain card, no interactive prompt ──
$queueAfter = json_decode($game->players[1]['player_pending_effects'], true);
check('pending_effects queue is empty (both draw_cards and gain_weather auto-resolved)', count($queueAfter) === 0, json_encode($queueAfter));

$heldBonus = $game->weatherCards->getCardsInLocation('weather_public_bonus', 1);
check('Alice holds exactly 1 bonus weather card', count($heldBonus) === 1, 'count=' . count($heldBonus));

$held = array_values($heldBonus)[0] ?? null;
check(
    'the held card is condition RAIN (type_arg = WeatherCards::CONDITION_RAIN), not just any card',
    $held && (int)$held['type_arg'] === WeatherCards::CONDITION_RAIN,
    $held ? ('type_arg=' . $held['type_arg']) : 'no card held'
);

$remainingRainInMarket = $game->weatherCards->getCardsOfTypeInLocation('bonus', WeatherCards::CONDITION_RAIN, 'bonus_deck');
check('exactly 2 Bonus Rain cards remain in the market (3 - 1 taken)', count($remainingRainInMarket) === 2, 'count=' . count($remainingRainInMarket));

$notifNames = array_map(fn($e) => $e['name'], $bga->notify->log);
check('no interactive "pendingEffects" prompt was sent (effect resolved automatically)', !in_array('pendingEffects', $notifNames, true), json_encode($notifNames));
check('server sent "playerGainedWeather" (auto-grant notification)', in_array('playerGainedWeather', $notifNames, true));

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
