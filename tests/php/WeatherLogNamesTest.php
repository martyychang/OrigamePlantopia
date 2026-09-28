<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/I8q5jUkM
 * "Show which weather cards were flipped and which were revealed in game log"
 *
 * The game log now names specific weather cards. This covers:
 *   1. WeatherCards::describeCard / describeCards — the name lookup.
 *   2. WeatherPhaseReveal — names each REVEALED card and its revealer. The
 *      tricky part is that moveAllCardsInLocation('weather_chosen', ...) resets
 *      location_arg to 0, so the owner must be captured from weather_chosen
 *      BEFORE the move; this test seeds two players' chosen cards and asserts
 *      the per-card "message" notifications carry the right player + card name.
 *
 * Run: php tests/php/WeatherLogNamesTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../plantopia/modules/php/WeatherCards.php';
require __DIR__ . '/../../plantopia/modules/php/WeatherPhaseBonusSubstate.php';
require __DIR__ . '/../../plantopia/modules/php/States/WeatherPhaseBonus.php';
require __DIR__ . '/../../plantopia/modules/php/States/WeatherPhaseReveal.php';

use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\WeatherCards;
use Bga\Games\Plantopia\WeatherPhaseBonusSubstate;
use Bga\Games\Plantopia\States\WeatherPhaseReveal;
use Bga\GameFramework\BgaStub;

$failures = 0;
function check(string $label, bool $cond, string $detail = ''): void {
    global $failures;
    echo ($cond ? "  ok  — $label\n" : ("  FAIL — $label" . ($detail ? " ($detail)" : '') . "\n"));
    if (!$cond) $failures++;
}

// ── 1. Name lookup ──
echo "--- describeCard / describeCards ---\n";
check("carrot cond 1 (Rain) => 'Carrot Rain'", WeatherCards::describeCard(['type' => 'carrot', 'type_arg' => 1]) === 'Carrot Rain');
check("potato cond 0 (Sun) => 'Potato Sun'",    WeatherCards::describeCard(['type' => 'potato', 'type_arg' => 0]) === 'Potato Sun');
check("bonus cond 2 (Wind) => 'Bonus Wind'",    WeatherCards::describeCard(['type' => 'bonus',  'type_arg' => 2]) === 'Bonus Wind');
check("describeCards joins with ', '",
    WeatherCards::describeCards([['type' => 'carrot', 'type_arg' => 0], ['type' => 'bonus', 'type_arg' => 1]]) === 'Carrot Sun, Bonus Rain');

// ── 2. WeatherPhaseReveal names each revealed card + revealer ──
echo "--- WeatherPhaseReveal game-log naming ---\n";
$game = new Game();
$game->players[1] = ['name' => 'Alice', 'player_planting_status' => 1, 'player_bonus_weather_status' => WeatherPhaseBonusSubstate::Passed->value];
$game->players[2] = ['name' => 'Bob', 'player_planting_status' => 1, 'player_bonus_weather_status' => WeatherPhaseBonusSubstate::Passed->value];
$game->currentPlayerId = 1;
$game->weatherCards->seed('carrot', 1, 'weather_chosen', 1, 1);  // Alice revealed Carrot Rain
$game->weatherCards->seed('potato', 0, 'weather_chosen', 2, 1);  // Bob revealed Potato Sun

$bga = new BgaStub();
$state = new WeatherPhaseReveal($game);
$state->bga = $bga;
$state->onEnteringState(0);

// Collect the per-card reveal "message" notifications.
$reveals = [];
foreach ($bga->notify->log as $entry) {
    if ($entry['name'] === 'message' && isset($entry['args']['weather_name'])) {
        $reveals[$entry['args']['player_name']] = $entry['args']['weather_name'];
    }
}
check('Alice revealed Carrot Rain is named in the log', ($reveals['Alice'] ?? null) === 'Carrot Rain', json_encode($reveals));
check('Bob revealed Potato Sun is named in the log',   ($reveals['Bob'] ?? null) === 'Potato Sun', json_encode($reveals));
check('one reveal message per chosen card (2)', count($reveals) === 2, (string)count($reveals));

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
