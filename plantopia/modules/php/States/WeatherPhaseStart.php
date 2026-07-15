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

        // Discard any public and chosen weather cards from previous round
        $this->game->weatherCards->moveAllCardsInLocation('weather_public', 'discard');
        $this->game->weatherCards->moveAllCardsInLocation('weather_chosen', 'discard');

        $cardsToFlip = 0;
        if ($playerCount == 2) $cardsToFlip = 2;
        if ($playerCount == 3) $cardsToFlip = 1;
        if ($playerCount == 4) $cardsToFlip = 1;
        if ($playerCount == 5) $cardsToFlip = 0;

        if ($cardsToFlip > 0) {
            $flipped = $this->game->weatherCards->pickCardsForLocation($cardsToFlip, 'deck', 'weather_public', 0);
            if (count($flipped) < $cardsToFlip) {
                $this->game->weatherCards->moveAllCardsInLocation('discard', 'deck');
                $this->game->weatherCards->shuffle('deck');
                $flipped2 = $this->game->weatherCards->pickCardsForLocation($cardsToFlip - count($flipped), 'deck', 'weather_public', 0);
                $flipped = array_merge($flipped, $flipped2);
            }
            $this->bga->notify->all("weatherDeckFlipped", clienttranslate('Weather cards were flipped from the deck.'), [
                "cards" => $flipped
            ]);
        }

        return WeatherPhaseChoose::class;
    }
}
