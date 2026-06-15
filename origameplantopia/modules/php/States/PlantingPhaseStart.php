<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\OrigamePlantopia\Game;

class PlantingPhaseStart extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 29,
            type: StateType::GAME,
        );
    }

    public function onEnteringState(int $activePlayerId)
    {
        // Reset player planting statuses for the new round
        $this->game->DbQuery("UPDATE player SET player_planting_status = 0");

        return PlantingPhaseUpkeep::class;
    }
}
