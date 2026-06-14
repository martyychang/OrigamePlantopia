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
        return [];
    }

    public function onEnteringState(int $activePlayerId)
    {
        $players = $this->game->loadPlayersBasicInfos();
        $this->game->DbQuery("UPDATE player SET player_planting_status = 0");
        
        $activeIds = [];
        foreach ($players as $pId => $info) {
            $bonusCards = $this->game->weatherCards->getCardsOfTypeInLocation('bonus', null, 'hand', $pId);
            if (count($bonusCards) > 0) {
                $activeIds[] = $pId;
            } else {
                $this->game->DbQuery("UPDATE player SET player_planting_status = 1 WHERE player_id = $pId");
            }
        }
        
        $this->game->gamestate->setPlayersMultiactive($activeIds, WeatherPhaseGrow::class, true);
    }

    #[PossibleAction]
    public function actPlayBonusWeather(int $cardId)
    {
        $playerId = (int)$this->game->getCurrentPlayerId();

        $status = $this->game->getUniqueValueFromDb("SELECT player_planting_status FROM player WHERE player_id = $playerId");
        if ((int)$status === 1) {
            throw new UserException(clienttranslate("You have already passed."));
        }

        // Check card is in hand and is a bonus card
        $card = $this->game->weatherCards->getCard($cardId);
        if ($card['location'] !== 'hand' || (int)$card['location_arg'] !== $playerId) {
            throw new UserException(clienttranslate("You do not have this card in your hand."));
        }
        if ($card['type'] !== 'bonus') {
            throw new UserException(clienttranslate("You can only play bonus weather cards now."));
        }

        // Play the card (move to weather_public_bonus with location_arg = player_id)
        $this->game->weatherCards->moveCard($cardId, 'weather_public_bonus', $playerId);

        $this->bga->notify->player($playerId, "bonusWeatherPlayed", '', [
            "card" => $card
        ]);
        
        $this->bga->notify->all("playerPlayedBonus", clienttranslate('${player_name} played a bonus weather card.'), [
            "player_id" => $playerId,
            "card" => $card
        ]);
        
        // They might want to play another one, so we don't deactivate them.
        // They must explicitly click pass.
    }

    #[PossibleAction]
    public function actPassBonus()
    {
        $playerId = (int)$this->game->getCurrentPlayerId();
        $this->game->DbQuery("UPDATE player SET player_planting_status = 1 WHERE player_id = $playerId");
        $this->game->gamestate->setPlayerNonMultiactive($playerId, WeatherPhaseGrow::class);
    }

    function zombie(int $playerId) {
        $this->game->DbQuery("UPDATE player SET player_planting_status = 1 WHERE player_id = $playerId");
        $this->game->gamestate->setPlayerNonMultiactive($playerId, WeatherPhaseGrow::class);
    }
}
