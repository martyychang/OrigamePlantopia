<?php

declare(strict_types=1);

namespace Bga\Games\Plantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\WeatherPhaseBonusSubstate;

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
        // Capture who chose which card BEFORE moving — moveAllCardsInLocation
        // resets location_arg to 0, so the owner is only knowable here (each
        // weather_chosen card's location_arg is the player who chose it). Used
        // to name every revealed card and its revealer in the game log
        // (Trello I8q5jUkM).
        $chosen = $this->game->weatherCards->getCardsInLocation('weather_chosen');

        // 1. Move all chosen cards to public
        $this->game->weatherCards->moveAllCardsInLocation('weather_chosen', 'weather_public');

        // 3. Notify reveal
        $publicCards = $this->game->weatherCards->getCardsInLocation('weather_public');

        $this->bga->notify->all("weatherRevealed", clienttranslate('Weather cards have been revealed.'), [
            "cards" => $publicCards,
            "flipped" => []
        ]);

        // Name each revealed character weather card and who revealed it. Uses
        // the generic "message" notification (no client handler needed).
        foreach ($chosen as $card) {
            $revealerId = (int)$card['location_arg'];
            $this->bga->notify->all(
                "message",
                clienttranslate('${player_name} revealed ${weather_name}.'),
                [
                    "player_id"    => $revealerId,
                    "player_name"  => $this->game->getPlayerNameById($revealerId),
                    "weather_name" => \Bga\Games\Plantopia\WeatherCards::describeCard($card),
                    "i18n"         => ["weather_name"],
                ]
            );
        }

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
