<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/L56GTT7Q
 * "Gum Tree Card Effect is different from what's drawn on the card"
 *
 * The rulebook describes Gum Tree's effect as "Immediately gain THE 2
 * Bonus Weather Cards" — "the" refers to the two SPECIFIC cards drawn on
 * Gum Tree's own card art: a Bonus Rain Card and a Bonus Sun Card. That
 * "the" was dropped in transcription (both in this repo's earlier
 * card_effect text and in the reference Google Doc — see Marty's comment
 * on the card), which made the implementation read as "gain any 2 Bonus
 * Weather Cards" — an interactive, player's-choice grant of any 2 cards,
 * not the two specific cards the card art actually shows.
 *
 * Fixed by giving PlantCards.php's Gum Tree entry a new
 * gain_weather_types (plural) field — [WEATHER_RAIN, WEATHER_SUN] — which
 * PlantingPhase::queueEffects() expands into two separate SPECIFIC-type
 * gain_weather queue entries (qty 1 each), each auto-resolved by the same
 * auto-grant path GainWeatherTypeTest.php covers for a single specific
 * type — no player choice, matching the corrected card_effect text
 * ("Immediately gain a Bonus Rain Card and a Bonus Sun Card").
 *
 * Drives the REAL PlantCards.php / WeatherCards.php / PlantingPhase.php
 * (unmodified) against the fake BGA framework in harness.php.
 *
 * Run: php tests/php/GumTreeGainWeatherTest.php
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

check('Gum Tree\'s card_effect text matches the corrected wording (no dropped "the")',
    PlantCards::getTypes()['Gum Tree']['card_effect'] === clienttranslate('Immediately gain a Bonus Rain Card and a Bonus Sun Card.'),
    PlantCards::getTypes()['Gum Tree']['card_effect']);
check('Gum Tree\'s planting_effect uses gain_weather_types: [RAIN, SUN], not a generic ANY qty-2 grant',
    (PlantCards::getTypes()['Gum Tree']['planting_effect']['gain_weather_types'] ?? null) === [PlantCards::WEATHER_RAIN, PlantCards::WEATHER_SUN],
    json_encode(PlantCards::getTypes()['Gum Tree']['planting_effect'] ?? null));

Game::$PLANT_CARD_TYPES = PlantCards::getTypes();

// ── Arrange: Alice plants Gum Tree (cost 2 cards) ──
$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
$game->currentPlayerId = 1;

// Full bonus market: 3 sun, 3 rain, 3 wind.
$game->weatherCards->seed('bonus', WeatherCards::CONDITION_SUN, 'bonus_deck', 0, 3);
$game->weatherCards->seed('bonus', WeatherCards::CONDITION_RAIN, 'bonus_deck', 0, 3);
$game->weatherCards->seed('bonus', WeatherCards::CONDITION_WIND, 'bonus_deck', 0, 3);

$fillerIds = $game->plantCards->seed('Buttercup', 0, 'deck', 0, 40);
[$gumTreeId] = $game->plantCards->seed('Gum Tree', 0, 'hand', 1, 1);
$game->plantCards->moveCards([$fillerIds[0], $fillerIds[1]], 'hand', 1); // 2 payment cards

[$planterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);

$bga = new BgaStub();
$state = new PlantingPhase($game);
$state->bga = $bga;

// ── Act: plant Gum Tree ──
$state->actPlant($gumTreeId, $planterId, $fillerIds[0] . ';' . $fillerIds[1]);

// ── Assert: Alice was auto-granted BOTH a Rain and a Sun card, no interactive prompt ──
$queueAfter = json_decode($game->players[1]['player_pending_effects'], true);
check('pending_effects queue is empty — both gain_weather entries auto-resolved', count($queueAfter) === 0, json_encode($queueAfter));

$heldBonus = $game->weatherCards->getCardsInLocation('weather_public_bonus', 1);
check('Alice holds exactly 2 bonus weather cards', count($heldBonus) === 2, 'count=' . count($heldBonus));

$heldConditions = array_map(fn($c) => (int)$c['type_arg'], $heldBonus);
sort($heldConditions);
check('the 2 held cards are exactly one Sun and one Rain — not 2 of the player\'s choosing',
    $heldConditions === [WeatherCards::CONDITION_SUN, WeatherCards::CONDITION_RAIN],
    json_encode($heldConditions));

$remainingSun = $game->weatherCards->getCardsOfTypeInLocation('bonus', WeatherCards::CONDITION_SUN, 'bonus_deck');
$remainingRain = $game->weatherCards->getCardsOfTypeInLocation('bonus', WeatherCards::CONDITION_RAIN, 'bonus_deck');
$remainingWind = $game->weatherCards->getCardsOfTypeInLocation('bonus', WeatherCards::CONDITION_WIND, 'bonus_deck');
check('exactly 2 Sun cards remain in the market (3 - 1 taken)', count($remainingSun) === 2, 'count=' . count($remainingSun));
check('exactly 2 Rain cards remain in the market (3 - 1 taken)', count($remainingRain) === 2, 'count=' . count($remainingRain));
check('all 3 Wind cards remain untouched (never eligible for this effect)', count($remainingWind) === 3, 'count=' . count($remainingWind));

$notifNames = array_map(fn($e) => $e['name'], $bga->notify->log);
check('no interactive "pendingEffects" prompt was sent (both cards auto-granted, no player choice)', !in_array('pendingEffects', $notifNames, true), json_encode($notifNames));
check('server sent "playerGainedWeather" twice (once per auto-granted card)', count(array_filter($notifNames, fn($n) => $n === 'playerGainedWeather')) === 2, json_encode($notifNames));

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
