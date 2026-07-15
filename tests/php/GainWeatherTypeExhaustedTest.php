<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/ngnBJhnS
 * "When Treegonometree was planted with no more Bonus Rain cards, player
 * stuck on 'Choose a Bonus Weather card to gain'"
 *
 * Root cause: a typed gain_weather effect (e.g. Treegonometree: "gain a
 * Bonus Rain Card") is supposed to grant ONLY that specific weather type —
 * the card text has no "or any other type" fallback, unlike Geometree's
 * genuinely generic "gain any Bonus Weather Card" (queued with WEATHER_ANY
 * from the start). But processPendingEffects's gain_weather branch used to
 * downgrade a typed effect to WEATHER_ANY and open an interactive "choose
 * any weather card" prompt whenever the OVERALL bonus market was non-empty
 * — even though Rain specifically was gone — silently handing out a
 * different type than the planted card promises. And when the whole
 * market WAS also empty, the effect was popped with no notification at
 * all, leaving the player's client showing a stale prompt with no way to
 * resolve it short of a reload.
 *
 * Drives the REAL PlantCards.php / WeatherCards.php / PlantingPhase.php
 * (unmodified) against the fake BGA framework in harness.php.
 *
 * Run: php tests/php/GainWeatherTypeExhaustedTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../plantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../plantopia/modules/php/WeatherCards.php';
require __DIR__ . '/../../plantopia/modules/php/PlantingPlayerSubstate.php';
require __DIR__ . '/../../plantopia/modules/php/States/PlantingPhase.php';

use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\PlantCards;
use Bga\Games\Plantopia\WeatherCards;
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

// ── Scenario 1: Rain is exhausted, but Sun/Wind remain in the market ──────
echo "--- Rain exhausted, Sun/Wind still available: no Rain gained, no ANY prompt ---\n";
$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
$game->currentPlayerId = 1;

// Rain pool is fully claimed; Sun/Wind still have cards.
$game->weatherCards->seed('bonus', WeatherCards::CONDITION_SUN, 'bonus_deck', 0, 3);
$game->weatherCards->seed('bonus', WeatherCards::CONDITION_WIND, 'bonus_deck', 0, 3);

$fillerIds = $game->plantCards->seed('Buttercup', 0, 'deck', 0, 40);
[$treegonoId] = $game->plantCards->seed('Treegonometree', 0, 'hand', 1, 1);
$game->plantCards->moveCard($fillerIds[0], 'hand', 1);
$paymentCardId = $fillerIds[0];
[$planterId] = $game->planterCards->seed('planter', 0, 'garden', 1, 1);

$bga = new BgaStub();
$state = new PlantingPhase($game);
$state->bga = $bga;

$state->actPlant($treegonoId, $planterId, (string)$paymentCardId);

$queueAfter = json_decode($game->players[1]['player_pending_effects'], true);
check('effect resolves immediately, no lingering pending_effects', count($queueAfter) === 0, json_encode($queueAfter));

$held = $game->weatherCards->getCardsInLocation('weather_public_bonus', 1);
check('Alice was NOT granted a Sun or Wind card as a substitute', count($held) === 0, 'count=' . count($held));

$notifNames = array_map(fn($e) => $e['name'], $bga->notify->log);
check('no interactive "pendingEffects" prompt was ever sent', !in_array('pendingEffects', $notifNames, true), json_encode($notifNames));
check('no "playerGainedWeather" notification (nothing was gained)', !in_array('playerGainedWeather', $notifNames, true), json_encode($notifNames));

$messages = array_values(array_filter($bga->notify->log, fn($e) => $e['name'] === 'message'));
$hasCouldNotGainMessage = false;
foreach ($messages as $m) {
    if (($m['args']['weather_name'] ?? '') === 'Rain' && ($m['args']['player_id'] ?? null) === 1) { $hasCouldNotGainMessage = true; }
}
check('a "could not gain a Bonus Rain Card" move message was posted', $hasCouldNotGainMessage, json_encode($messages));

$sunRemaining = $game->weatherCards->getCardsOfTypeInLocation('bonus', WeatherCards::CONDITION_SUN, 'bonus_deck');
$windRemaining = $game->weatherCards->getCardsOfTypeInLocation('bonus', WeatherCards::CONDITION_WIND, 'bonus_deck');
check('Sun market untouched (3 remain)', count($sunRemaining) === 3, 'count=' . count($sunRemaining));
check('Wind market untouched (3 remain)', count($windRemaining) === 3, 'count=' . count($windRemaining));

// ── Scenario 2: entire bonus market is empty (no Rain, no Sun, no Wind) ───
echo "\n--- entire bonus market exhausted: effect still resolves cleanly with a message ---\n";
$game2 = new Game();
$game2->players[1] = ['name' => 'Bob', 'player_pending_effects' => '[]', 'player_planting_status' => 0, 'player_banana_used' => 0];
$game2->currentPlayerId = 1;
// No weatherCards seeded at all — bonus_deck is fully empty.

$fillerIds2 = $game2->plantCards->seed('Buttercup', 0, 'deck', 0, 40);
[$treegonoId2] = $game2->plantCards->seed('Treegonometree', 0, 'hand', 1, 1);
$game2->plantCards->moveCard($fillerIds2[0], 'hand', 1);
$paymentCardId2 = $fillerIds2[0];
[$planterId2] = $game2->planterCards->seed('planter', 0, 'garden', 1, 1);

$bga2 = new BgaStub();
$state2 = new PlantingPhase($game2);
$state2->bga = $bga2;

$state2->actPlant($treegonoId2, $planterId2, (string)$paymentCardId2);

$queueAfter2 = json_decode($game2->players[1]['player_pending_effects'], true);
check('effect resolves immediately even with a fully empty market', count($queueAfter2) === 0, json_encode($queueAfter2));

$notifNames2 = array_map(fn($e) => $e['name'], $bga2->notify->log);
check('no interactive "pendingEffects" prompt was sent', !in_array('pendingEffects', $notifNames2, true), json_encode($notifNames2));

$messages2 = array_values(array_filter($bga2->notify->log, fn($e) => $e['name'] === 'message'));
$hasMessage2 = false;
foreach ($messages2 as $m) {
    if (($m['args']['weather_name'] ?? '') === 'Rain' && ($m['args']['player_id'] ?? null) === 1) { $hasMessage2 = true; }
}
check('a "could not gain a Bonus Rain Card" move message was posted', $hasMessage2, json_encode($messages2));

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
