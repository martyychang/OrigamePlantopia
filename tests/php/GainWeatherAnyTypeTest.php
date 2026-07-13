<?php
declare(strict_types=1);

/**
 * Systematic card-by-card audit (Marty's request): functional coverage
 * for the ANY-type gain_weather path (interactive — the player picks which
 * card(s) from the market via actResolveGainWeather), which is a
 * completely different code path from the SPECIFIC-type one
 * GainWeatherTypeTest.php covers.
 *
 * Originally used Gum Tree ("gain 2 Bonus Weather Cards", any condition,
 * qty 2) as its example card for the qty > 1 decrement-until-done loop.
 * https://trello.com/c/L56GTT7Q corrected Gum Tree's effect to grant two
 * DIFFERENT SPECIFIC types (a Bonus Rain Card and a Bonus Sun Card, no
 * player choice — see gain_weather_types in PlantCards.php) — it no longer
 * exercises the ANY-type path at all, and no other card currently has
 * gain_weather_qty > 1 with WEATHER_ANY. The qty > 1 decrement loop in
 * actResolveGainWeather is still real, load-bearing engine code (and could
 * apply to a future card), so this test builds the pending_effects queue
 * directly (bypassing actPlant/queueEffects) rather than depending on any
 * one card's data staying a particular shape. Geometree is still the
 * catalog's one real ANY-type card (qty 1); PlantingEffectKeysTest.php
 * covers its data shape.
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
$game->weatherCards->seed('bonus', WeatherCards::CONDITION_SUN, 'bonus_deck', 0, 3);
$game->weatherCards->seed('bonus', WeatherCards::CONDITION_RAIN, 'bonus_deck', 0, 3);
$game->weatherCards->seed('bonus', WeatherCards::CONDITION_WIND, 'bonus_deck', 0, 3);

$bga = new BgaStub();
$state = new PlantingPhase($game);
$state->bga = $bga;

// A hypothetical "gain 2 Bonus Weather Cards, any condition" effect —
// same shape Gum Tree used to have — built directly rather than via a
// specific card's planting_effect, since no current card has this shape.
$game->players[1]['player_pending_effects'] = json_encode([
    ['type' => 'gain_weather', 'weather_type' => PlantCards::WEATHER_ANY, 'qty' => 2],
]);

$queue = json_decode($game->players[1]['player_pending_effects'], true);
check('queue starts as an interactive gain_weather:ANY effect with qty 2', count($queue) === 1 && $queue[0]['type'] === 'gain_weather' && $queue[0]['weather_type'] === PlantCards::WEATHER_ANY && $queue[0]['qty'] === 2, json_encode($queue));

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
