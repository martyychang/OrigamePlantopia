<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\OrigamePlantopia\Game;

class DistributeWeather extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 13,
            type: StateType::GAME,
        );
    }

    public function onEnteringState(int $activePlayerId)
    {
        $players = $this->game->loadPlayersBasicInfos();

        foreach ($players as $pId => $pInfo) {
            $chars = $this->game->characterCards->getCardsInLocation('garden', $pId);
            if (count($chars) === 0) continue;

            $characterCard = array_values($chars)[0];
            $characterType = $characterCard['type'];

            // Find the 3 weather cards for this character
            $weatherDeck = $this->game->weatherCards->getCardsInLocation('deck');
            $cardsToMove = [];
            foreach ($weatherDeck as $wCard) {
                if ($wCard['type'] === $characterType) {
                    $cardsToMove[] = $wCard['id'];
                }
            }

            // Move the character weather cards to the player's hand.
            // NOTE: Mushroom's "1 Bonus Weather Card of each type" ability is
            // NOT granted here — it's already granted exactly once, at claim
            // time, in SetupDecisions::applyClaimAbility(). Granting it again
            // here (as this state previously did) doubled Mushroom's bonus
            // weather to 6 cards instead of 3. See https://trello.com/c/uiJWdVTg.
            $this->game->weatherCards->moveCards($cardsToMove, 'hand', $pId);

            // Send notification to the player
            $newHand = $this->game->weatherCards->getCardsInLocation('hand', $pId);
            $this->bga->notify->player($pId, "receivedWeatherCards", '', [
                "cards" => $newHand
            ]);

            $this->bga->notify->all("playerReceivedWeather", clienttranslate('${player_name} received their Character Weather cards.'), [
                "player_id" => $pId,
                "player_name" => $this->game->getPlayerNameById($pId),
            ]);
        }

        // Shuffle the remaining weather cards
        $this->game->weatherCards->shuffle('deck');

        return PlantingPhaseStart::class;
    }
}
