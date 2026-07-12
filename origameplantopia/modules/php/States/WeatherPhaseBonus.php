<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\UserException;
use Bga\Games\OrigamePlantopia\Game;
use Bga\Games\OrigamePlantopia\WeatherPhaseBonusSubstate;

class WeatherPhaseBonus extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 43,
            type: StateType::MULTIPLE_ACTIVE_PLAYER,
        );
    }

    public function getArgs(): array
    {
        // No player-status blob (see the https://trello.com/c/DCpOIanp
        // history below) — but DOES return fresh, authoritative
        // weather_public_bonus data. This is deliberately NOT left to the
        // weatherCleared notification (fired one state earlier, by
        // WeatherPhaseGrow) to keep the client in sync: BGA queues/paces
        // notifications separately from state-transition rendering (for
        // animation), so a client can render this state's UI before that
        // notification's queued processing has actually applied — the
        // player's held cards would look empty/stale until something else
        // (like a reload, which re-fetches everything synchronously)
        // forced a resync. getArgs() is evaluated synchronously as part of
        // entering this exact state, so args always reflects current DB
        // truth by the time the client renders. See
        // https://trello.com/c/61uLM9hR and "State Transitions & Frontend
        // Synchronization" in AGENTS.md.
        //
        // Separately: no player-status blob here at all — the client
        // derives whether a player is active from isCurrentPlayerActive
        // (BGA's own authoritative multiactive-player tracking), not a
        // synced status value. A previous version of this method returned
        // player_bonus_weather_status under the key 'planting_statuses' —
        // reused from PlantingPhase's own getArgs() — and the client wrote
        // the result into the SAME shared gamedatas.players[pId].planting_status
        // field PlantingPhase uses for its own, unrelated "done planting"
        // status. That collision (plus a redundant client-side check that
        // could override isCurrentPlayerActive) is what caused both
        // players to see "Waiting for other players..." right after
        // entering this state, fixable only by a page reload. See
        // https://trello.com/c/DCpOIanp and the "MULTIPLE_ACTIVE_PLAYER
        // Client State: isCurrentPlayerActive Is the Only Truth" note in
        // AGENTS.md.
        return [
            'weatherPublicBonus' => $this->game->weatherCards->getCardsInLocation('weather_public_bonus'),
        ];
    }

    public function onEnteringState(int $activePlayerId)
    {
        // Deliberately does NOT reset player_bonus_weather_status here —
        // that DB write now happens in WeatherPhaseReveal::onEnteringState()
        // (the OUTGOING transition into this state), not here. See the
        // comment there and "State Transitions & Frontend Synchronization"
        // in AGENTS.md for why a reset performed inside a
        // MULTIPLE_ACTIVE_PLAYER state's own onEnteringState() races with
        // getArgs() and can transmit a stale value to clients.
        $this->game->gamestate->setAllPlayersMultiactive();
    }

    #[PossibleAction]
    public function actPlayBonusWeather(string $cardIds)
    {
        $playerId = (int)$this->game->getCurrentPlayerId();

        if ($this->substateOf($playerId) === WeatherPhaseBonusSubstate::Passed) {
            throw new UserException(clienttranslate("You have already passed."));
        }

        $cardIds = $cardIds === '' ? [] : array_map('intval', explode(';', $cardIds));
        
        foreach ($cardIds as $cardId) {
            // Card must be in the player's public bonus stash (per
            // https://trello.com/c/B5g3UmED — bonus weather is publicly held,
            // not in hand, until played).
            $card = $this->game->weatherCards->getCard($cardId);
            if ($card['location'] !== 'weather_public_bonus' || (int)$card['location_arg'] !== $playerId) {
                throw new UserException(clienttranslate("You do not have this Bonus Weather card."));
            }
            if ($card['type'] !== 'bonus') {
                throw new UserException(clienttranslate("You can only play bonus weather cards now."));
            }

            // Play the card: move from the public stash to the round's "played"
            // pool. WeatherPhaseGrow reads from weather_played_bonus for growth
            // contributions and dumps the pool back to bonus_deck at end of phase.
            $this->game->weatherCards->moveCard($cardId, 'weather_played_bonus', $playerId);

            $this->bga->notify->player($playerId, "bonusWeatherPlayed", '', [
                "card" => $card
            ]);

            $this->bga->notify->all("playerPlayedBonus", clienttranslate('${player_name} played a bonus weather card.'), [
                "player_id" => $playerId,
                "player_name" => $this->game->getPlayerNameById($playerId),
                "card" => $card
            ]);
        }
        
        // After playing, automatically pass
        $this->markPlayerPassed($playerId);
    }

    #[PossibleAction]
    public function actPassBonus()
    {
        $playerId = (int)$this->game->getCurrentPlayerId();

        if ($this->substateOf($playerId) === WeatherPhaseBonusSubstate::Passed) {
            throw new UserException(clienttranslate("You have already passed."));
        }

        $this->markPlayerPassed($playerId);
    }

    private function substateOf(int $playerId): WeatherPhaseBonusSubstate
    {
        return WeatherPhaseBonusSubstate::from((int)$this->game->getUniqueValueFromDb("SELECT player_bonus_weather_status FROM player WHERE player_id = $playerId"));
    }

    /**
     * The ONLY method allowed to conclude a player's substate for this
     * state — actPlayBonusWeather, actPassBonus, and zombie() all funnel
     * through here rather than writing player_bonus_weather_status and
     * calling checkIfAllPlayersReady() independently, so there's exactly
     * one place this transition can go wrong.
     */
    private function markPlayerPassed(int $playerId): void
    {
        $this->game->DbQuery("UPDATE player SET player_bonus_weather_status = " . WeatherPhaseBonusSubstate::Passed->value . " WHERE player_id = $playerId");
        $this->checkIfAllPlayersReady();
    }

    private function checkIfAllPlayersReady()
    {
        $players = $this->game->loadPlayersBasicInfos();
        $allReady = true;

        foreach ($players as $pId => $pInfo) {
            if ($this->substateOf((int)$pId) === WeatherPhaseBonusSubstate::Deciding) {
                $allReady = false;
                break;
            }
        }

        $playerId = (int)$this->game->getCurrentPlayerId();
        if ($allReady) {
            $this->game->gamestate->setPlayerNonMultiactive($playerId, WeatherPhaseGrow::class);
        } else {
            $this->game->gamestate->setPlayerNonMultiactive($playerId, '');
        }
    }

    function zombie(int $playerId) {
        $this->markPlayerPassed($playerId);
    }
}
