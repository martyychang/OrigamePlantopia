<?php

declare(strict_types=1);

namespace Bga\Games\Plantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\Plantopia\Game;

class PlantingPhaseStart extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 29,
            type: StateType::GAME,
            updateGameProgression: true,
        );
    }

    public function onEnteringState(int $activePlayerId)
    {
        $this->game->calculateAllScores();
        // Reset player planting statuses for the new round and clear the
        // per-round Banana ability flag so the Banana character can use the
        // discard-2-babies-for-extra-action ability once this Planting Phase.
        $this->game->DbQuery("UPDATE player SET player_planting_status = 0, player_banana_used = 0");

        return PlantingPhaseUpkeep::class;
    }
}
