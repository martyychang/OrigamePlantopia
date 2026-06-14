<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\OrigamePlantopia\Game;

class WeatherPhaseReveal extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 42,
            type: StateType::GAME,
        );
    }

    public function onEnteringState(int $activePlayerId)
    {
        // 1. Move all chosen cards to public
        $this->game->weatherCards->moveAllCardsInLocation('weather_chosen', 'weather_public');

        // 2. Draw 1 more card in 2p and 3p games
        $players = $this->game->loadPlayersBasicInfos();
        $playerCount = count($players);

        $flipped = [];
        if ($playerCount == 2 || $playerCount == 3) {
            $flipped = $this->game->weatherCards->pickCardsForLocation(1, 'deck', 'weather_public', 0) ?? [];
            if (count($flipped) < 1) {
                $this->game->weatherCards->moveAllCardsInLocation('discard', 'deck');
                $this->game->weatherCards->shuffle('deck');
                $flipped = $this->game->weatherCards->pickCardsForLocation(1, 'deck', 'weather_public', 0) ?? [];
            }
        }

        // 3. Notify reveal
        $publicCards = $this->game->weatherCards->getCardsInLocation('weather_public');
        
        $this->bga->notify->all("weatherRevealed", clienttranslate('Weather cards have been revealed.'), [
            "cards" => $publicCards,
            "flipped" => $flipped
        ]);

        return WeatherPhaseBonus::class;
    }
}
