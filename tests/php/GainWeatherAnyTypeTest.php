<?php
declare(strict_types=1);

/**
 * Systematic card-by-card audit (Marty's request): functional coverage
 * for the ANY-type gain_weather path (Gum Tree: "gain 2 Bonus Weather
 * Cards", any condition), which is a completely different code path from
 * the SPECIFIC-type one GainWeatherTypeTest.php covers — this one is
 * interactive (the player picks which card(s) from the market via
 * actResolveGainWeather) and had zero test coverage before this audit,
 * including the qty > 1 decrement-until-done loop.
 *
 * Run: php tests/php/GainWeatherAnyTypeTest.php
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

$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
$game->currentPlayerId = 1;
$game->plantCards->seed('Buttercup', 0, 'deck', 0, 40);
$game->weatherCards->seed('bonus', WeatherCards::CONDITION_SUN, 'bonus_deck', 0, 3);
$game->weatherCards->seed('bonus', WeatherCards::CONDITION_RAIN, 'bonus_deck', 0, 3);
$game->weatherCards->seed('bonus', WeatherCards::CONDITION_WIND, 'bonus_deck', 0, 3);

[$gumTreeId] = $game->plantCards->seed('Gum Tree', 0, 'hand', 1, 1);
$paymentIds = $game->plantCards->pickCards(2, 'deck', 1); // Gum Tree costs 2
[$planterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);

$bga = new BgaStub();
$state = new PlantingPhase($game);
$state->bga = $bga;
$state->actPlant($gumTreeId, $planterId, implode(';', array_keys($paymentIds)));

$queue = json_decode($game->players[1]['player_pending_effects'], true);
check('Gum Tree queues an interactive gain_weather:ANY effect with qty 2', count($queue) === 1 && $queue[0]['type'] === 'gain_weather' && $queue[0]['weather_type'] === PlantCards::WEATHER_ANY && $queue[0]['qty'] === 2, json_encode($queue));

// Player picks a Sun card first.
$sunCards = $game->weatherCards->getCardsOfTypeInLocation('bonus', WeatherCards::CONDITION_SUN, 'bonus_deck');
$firstPick = array_key_first($sunCards);
$state->actResolveGainWeather($firstPick);

$queueAfterFirst = json_decode($game->players[1]['player_pending_effects'], true);
check('effect stays queued after 1 of 2 picks (qty decremented, not yet done)', count($queueAfterFirst) === 1 && $queueAfterFirst[0]['qty'] === 1, json_encode($queueAfterFirst));

// Second pick — a Wind card, confirming the player can freely choose a DIFFERENT condition each time (truly "any").
$windCards = $game->weatherCards->getCardsOfTypeInLocation('bonus', WeatherCards::CONDITION_WIND, 'bonus_deck');
$secondPick = array_key_first($windCards);
$state->actResolveGainWeather($secondPick);

check('pending_effects queue is empty after both picks', count(json_decode($game->players[1]['player_pending_effects'], true)) === 0);

$held = $game->weatherCards->getCardsInLocation('weather_public_bonus', 1);
check('Alice holds exactly 2 bonus weather cards total', count($held) === 2, 'count=' . count($held));
$heldConditions = array_map(fn($c) => (int)$c['type_arg'], $held);
sort($heldConditions);
check('the 2 held cards are one Sun (0) and one Wind (2), matching the 2 distinct picks', $heldConditions === [WeatherCards::CONDITION_SUN, WeatherCards::CONDITION_WIND], json_encode($heldConditions));

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
