<?php
declare(strict_types=1);

/**
 * Regression test for https://trello.com/c/jVMK0VRz
 * "Number of weather cards" — there must ALWAYS be 5 Weather Cards revealed each
 * round, regardless of player count. 2p/3p games were only revealing 4 because
 * the deck's face-DOWN card was never drawn/revealed.
 *
 * WeatherPhaseStart now draws the deck's contribution as face-up + face-down:
 *   2p: 2 up + 1 down, 3p: 1 up + 1 down, 4p: 1 up + 0 down, 5p: 0.
 * WeatherPhaseReveal flips the face-down card(s) together with the players'
 * chosen cards, so weather_public always ends at 5 (deck + players).
 *
 * Run: php tests/php/WeatherFiveCardsTest.php
 */

require __DIR__ . '/harness.php';
require __DIR__ . '/../../plantopia/modules/php/PlantCards.php';
require __DIR__ . '/../../plantopia/modules/php/WeatherCards.php';
require __DIR__ . '/../../plantopia/modules/php/WeatherPhaseBonusSubstate.php';
require __DIR__ . '/../../plantopia/modules/php/States/WeatherPhaseStart.php';
require __DIR__ . '/../../plantopia/modules/php/States/WeatherPhaseReveal.php';

use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\States\WeatherPhaseStart;
use Bga\Games\Plantopia\States\WeatherPhaseReveal;
use Bga\GameFramework\BgaStub;

$failures = 0;
function check(string $label, bool $cond, string $detail = ''): void {
    global $failures;
    echo ($cond ? "  ok  — $label\n" : ("  FAIL — $label" . ($detail ? " ($detail)" : '') . "\n"));
    if (!$cond) $failures++;
}

Game::$PLANT_CARD_TYPES = \Bga\Games\Plantopia\PlantCards::getTypes();

function freshGame(int $nPlayers): Game {
    $g = new Game();
    $g->bga = new BgaStub();
    for ($i = 1; $i <= $nPlayers; $i++) $g->players[$i] = ['name' => "P$i"];
    // Seed a full-ish weather deck (character weather cards of each condition).
    foreach (['carrot', 'potato', 'mushroom', 'banana', 'tomato'] as $ch) {
        foreach ([0, 1, 2] as $cond) $g->weatherCards->seed($ch, $cond, 'deck', 0, 2);
    }
    return $g;
}

function run(int $nPlayers, int $expUp, int $expDown): void {
    $g = freshGame($nPlayers);
    $start = new WeatherPhaseStart($g); $start->bga = $g->bga;
    $start->onEnteringState(0);

    $up = count($g->weatherCards->getCardsInLocation('weather_public'));
    $down = count($g->weatherCards->getCardsInLocation('weather_facedown'));
    check("{$nPlayers}p: $expUp face-up flipped from deck", $up === $expUp, "got $up");
    check("{$nPlayers}p: $expDown face-down drawn from deck", $down === $expDown, "got $down");

    // Each player chooses 1 card (seed into weather_chosen with their id).
    for ($i = 1; $i <= $nPlayers; $i++) $g->weatherCards->seed('carrot', 0, 'weather_chosen', $i, 1);

    $reveal = new WeatherPhaseReveal($g); $reveal->bga = $g->bga;
    $reveal->onEnteringState(0);

    $publicTotal = count($g->weatherCards->getCardsInLocation('weather_public'));
    $leftoverDown = count($g->weatherCards->getCardsInLocation('weather_facedown'));
    check("{$nPlayers}p: exactly 5 Weather Cards revealed after reveal", $publicTotal === 5, "got $publicTotal");
    check("{$nPlayers}p: no face-down cards left after reveal", $leftoverDown === 0, "got $leftoverDown");
}

echo "--- 2 players ---\n"; run(2, 2, 1);
echo "--- 3 players ---\n"; run(3, 1, 1);
echo "--- 4 players ---\n"; run(4, 1, 0);
echo "--- 5 players ---\n"; run(5, 0, 0);

echo "\n" . ($failures === 0 ? "ALL CHECKS PASSED\n" : "$failures CHECK(S) FAILED\n");
exit($failures === 0 ? 0 : 1);
