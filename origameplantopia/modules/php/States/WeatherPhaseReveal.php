<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\OrigamePlantopia\Game;
use Bga\Games\OrigamePlantopia\WeatherPhaseBonusSubstate;

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

        // 3. Notify reveal
        $publicCards = $this->game->weatherCards->getCardsInLocation('weather_public');

        $this->bga->notify->all("weatherRevealed", clienttranslate('Weather cards have been revealed.'), [
            "cards" => $publicCards,
            "flipped" => []
        ]);

        $this->game->DbQuery("UPDATE player SET player_planting_status = 0");

        // Reset WeatherPhaseBonus's own substate here, in the OUTGOING
        // transition of the state BEFORE it — not inside
        // WeatherPhaseBonus::onEnteringState() itself. Because of how the
        // BGA framework broadcasts MULTIPLE_ACTIVE_PLAYER transitions,
        // getArgs() can be evaluated before or simultaneously with that
        // state's own onEnteringState(); a reset performed there risks
        // getArgs() reading the pre-reset (stale) DB value and transmitting
        // it to clients, which could then render both players as already
        // "done" the instant the state begins. See "State Transitions &
        // Frontend Synchronization" in AGENTS.md (a rule already known and
        // followed for player_planting_status right above — this fix
        // extends it to player_bonus_weather_status, which had been the
        // one holdout still doing the reset the risky way, and was the
        // root cause of https://trello.com/c/DCpOIanp).
        $this->game->DbQuery("UPDATE player SET player_bonus_weather_status = " . WeatherPhaseBonusSubstate::Deciding->value);

        return WeatherPhaseBonus::class;
    }
}
