<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\OrigamePlantopia\Game;

class WeatherPhaseStart extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 40,
            type: StateType::GAME,
        );
    }

    public function onEnteringState(int $activePlayerId)
    {
        // TODO: Implement Weather Phase setup
        $this->bga->notify->all("message", clienttranslate('Weather Phase begins! (Not fully implemented yet)'), []);

        // For now, loop back to Planting Phase Draw to test the cycle
        // Or go to NextPlayer if end game.
        return PlantingPhaseDraw::class;
    }
}
