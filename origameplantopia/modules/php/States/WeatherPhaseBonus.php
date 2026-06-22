<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\UserException;
use Bga\Games\OrigamePlantopia\Game;

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
        $players = $this->game->loadPlayersBasicInfos();
        $statuses = [];
        foreach ($players as $pId => $pInfo) {
            $statuses[$pId] = (int)$this->game->getUniqueValueFromDb("SELECT player_planting_status FROM player WHERE player_id = $pId");
        }
        return [
            'planting_statuses' => $statuses
        ];
    }

    public function onEnteringState(int $activePlayerId)
    {
        $this->game->DbQuery("UPDATE player SET player_planting_status = 0");
        $this->game->gamestate->setAllPlayersMultiactive();
    }

    #[PossibleAction]
    public function actPlayBonusWeather(string $cardIds)
    {
        $playerId = (int)$this->game->getCurrentPlayerId();

        $status = $this->game->getUniqueValueFromDb("SELECT player_planting_status FROM player WHERE player_id = $playerId");
        if ((int)$status === 1) {
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
        $this->game->DbQuery("UPDATE player SET player_planting_status = 1 WHERE player_id = $playerId");
        $this->checkIfAllPlayersReady();
    }

    #[PossibleAction]
    public function actPassBonus()
    {
        $playerId = (int)$this->game->getCurrentPlayerId();
        
        $status = $this->game->getUniqueValueFromDb("SELECT player_planting_status FROM player WHERE player_id = $playerId");
        if ((int)$status === 1) {
            throw new UserException(clienttranslate("You have already passed."));
        }

        $this->game->DbQuery("UPDATE player SET player_planting_status = 1 WHERE player_id = $playerId");
        $this->checkIfAllPlayersReady();
    }

    private function checkIfAllPlayersReady()
    {
        $players = $this->game->loadPlayersBasicInfos();
        $allReady = true;
        
        foreach ($players as $pId => $pInfo) {
            $status = $this->game->getUniqueValueFromDb("SELECT player_planting_status FROM player WHERE player_id = $pId");
            if ((int)$status === 0) {
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
        $this->game->DbQuery("UPDATE player SET player_planting_status = 1 WHERE player_id = $playerId");
        $this->checkIfAllPlayersReady();
    }
}
