<?php

declare(strict_types=1);

namespace Bga\Games\Plantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\Plantopia\Game;

class WeatherPhaseStart extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 40,
            type: StateType::GAME,
            updateGameProgression: true,
        );
    }

    public function onEnteringState(int $activePlayerId)
    {
        $this->game->calculateAllScores();
        $players = $this->game->loadPlayersBasicInfos();
        $playerCount = count($players);

        // Discard any public, chosen, and leftover face-down weather cards
        // from the previous round.
        $this->game->weatherCards->moveAllCardsInLocation('weather_public', 'discard');
        $this->game->weatherCards->moveAllCardsInLocation('weather_chosen', 'discard');
        $this->game->weatherCards->moveAllCardsInLocation('weather_facedown', 'discard');

        // Per the rulebook, the total number of Weather Cards revealed each
        // round is always 5 regardless of player count (Trello jVMK0VRz).
        // The deck contributes the difference between 5 and the player count:
        // some are flipped face-up now, and (for 2p/3p) one is drawn FACE-DOWN
        // and only revealed later, alongside the players' chosen cards.
        //   2p: 2 face-up + 1 face-down (+ 2 players = 5)
        //   3p: 1 face-up + 1 face-down (+ 3 players = 5)
        //   4p: 1 face-up            (+ 4 players = 5)
        //   5p: none                 (+ 5 players = 5)
        $faceUp = 0; $faceDown = 0;
        if ($playerCount == 2)      { $faceUp = 2; $faceDown = 1; }
        elseif ($playerCount == 3)  { $faceUp = 1; $faceDown = 1; }
        elseif ($playerCount == 4)  { $faceUp = 1; $faceDown = 0; }
        // 5p: both 0

        // Draw n cards from the deck into $loc, reshuffling the discard pile
        // back in if the deck runs short.
        $draw = function (int $n, string $loc): array {
            if ($n <= 0) return [];
            $got = $this->game->weatherCards->pickCardsForLocation($n, 'deck', $loc, 0);
            if (count($got) < $n) {
                $this->game->weatherCards->moveAllCardsInLocation('discard', 'deck');
                $this->game->weatherCards->shuffle('deck');
                $got = array_merge($got, $this->game->weatherCards->pickCardsForLocation($n - count($got), 'deck', $loc, 0));
            }
            return $got;
        };

        $flipped = $draw($faceUp, 'weather_public');
        if (count($flipped) > 0) {
            $this->bga->notify->all("weatherDeckFlipped", clienttranslate('Weather cards flipped from the deck: ${weather_names}.'), [
                "cards" => $flipped,
                "weather_names" => \Bga\Games\Plantopia\WeatherCards::describeCards($flipped),
            ]);
        }

        // Face-down deck card(s): held hidden (identity not sent to clients)
        // until WeatherPhaseReveal flips them with everyone's chosen cards.
        $faceDownCards = $draw($faceDown, 'weather_facedown');
        if (count($faceDownCards) > 0) {
            $this->bga->notify->all("weatherFaceDownDrawn", clienttranslate('A face-down Weather card was drawn from the deck — it will be revealed with everyone\'s cards.'), [
                "count" => count($faceDownCards),
            ]);
        }

        return WeatherPhaseChoose::class;
    }
}
