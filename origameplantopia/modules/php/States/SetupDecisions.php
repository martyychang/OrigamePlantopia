<?php

declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\UserException;
use Bga\Games\OrigamePlantopia\Game;
use Bga\Games\OrigamePlantopia\WeatherCards;

class SetupDecisions extends GameState
{
    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 20,
            type: StateType::MULTIPLE_ACTIVE_PLAYER,
        );
    }

    public function getArgs(): array
    {
        return [];
    }

    public function onEnteringState(int $activePlayerId)
    {
        $this->game->gamestate->setAllPlayersMultiactive();
        $this->game->giveExtraTimeToAllPlayers();
    }

    #[PossibleAction]
    public function actKeep()
    {
        $activePlayerId = (int)$this->game->getCurrentPlayerId();

        if ($this->hasMulliganed($activePlayerId)) {
            throw new UserException(clienttranslate("You have already made your mulligan decision."));
        }

        $this->game->DbQuery("UPDATE player SET player_mulligan_choice = 1 WHERE player_id = $activePlayerId");

        $this->bga->notify->all("playerKeptCards", clienttranslate('${player_name} kept their starting hand.'), [
            "player_id" => $activePlayerId,
        ]);

        $this->checkIfAllPlayersReady();
    }

    #[PossibleAction]
    public function actRedraw()
    {
        $activePlayerId = (int)$this->game->getCurrentPlayerId();

        if ($this->hasMulliganed($activePlayerId)) {
            throw new UserException(clienttranslate("You have already made your mulligan decision."));
        }

        $this->game->DbQuery("UPDATE player SET player_mulligan_choice = 2 WHERE player_id = $activePlayerId");

        // Player discards their 6 cards and draws 6 new ones.
        $hand = $this->game->plantCards->getCardsInLocation('hand', $activePlayerId);
        
        $cardIds = array_column($hand, 'id');
        $this->game->plantCards->moveCards($cardIds, 'discard');

        $this->game->plantCards->pickCards(6, 'deck', $activePlayerId);
        $newHand = $this->game->plantCards->getCardsInLocation('hand', $activePlayerId);

        $this->bga->notify->player($activePlayerId, "newHand", '', [
            "cards" => $newHand
        ]);

        $this->bga->notify->all("playerRedrewCards", clienttranslate('${player_name} redrew their starting hand.'), [
            "player_id" => $activePlayerId,
        ]);

        $this->checkIfAllPlayersReady();
    }

    #[PossibleAction]
    public function actClaimCharacter(int $cardId)
    {
        $activePlayerId = (int)$this->game->getCurrentPlayerId();

        if (!$this->hasMulliganed($activePlayerId)) {
            throw new UserException(clienttranslate("You must keep or redraw your hand first."));
        }

        // Ensure player doesn't already have a character
        $existing = $this->game->characterCards->getCardsInLocation('garden', $activePlayerId);
        if (count($existing) > 0) {
            throw new UserException(clienttranslate("You have already claimed a character."));
        }

        $card = $this->game->characterCards->getCard($cardId);
        if ($card['location'] !== 'deck') {
            throw new UserException(clienttranslate("This character has already been claimed."));
        }

        $this->game->characterCards->moveCard($cardId, 'garden', $activePlayerId);

        $this->bga->notify->all("characterClaimed", clienttranslate('${player_name} claimed the ${character_name} character.'), [
            "player_id" => $activePlayerId,
            "card" => $this->game->characterCards->getCard($cardId),
            "character_name" => Game::$CHARACTER_CARD_TYPES[$card['type']]['name']
        ]);

        $this->applyClaimAbility($activePlayerId, $card['type']);

        $this->checkIfAllPlayersReady();
    }

    /**
     * Apply the character's ability at the moment it's claimed.
     *
     * Phase 1 (this commit) wires up the start-of-game abilities:
     *   - Potato:   Start with 4 extra cards
     *   - Mushroom: Start with 1 Bonus Weather Card of each type
     *
     * Carrot / Tomato / Banana trigger during the Planting Phase and are wired
     * up in subsequent commits on the same Trello card
     * (https://trello.com/c/rgIS3JiZ).
     */
    private function applyClaimAbility(int $playerId, string $character): void
    {
        switch ($character) {
            case 'potato':
                // Draw 4 extra plant cards into the player's hand.
                $this->game->plantCards->pickCards(4, 'deck', $playerId);
                $newHand = $this->game->plantCards->getCardsInLocation('hand', $playerId);
                // Cast to int — see https://trello.com/c/vjsQX06a: the client
                // does numeric += on these across notifications, and a raw
                // numeric-string count from the Deck component poisons every
                // later update into string concatenation.
                $handCounts = array_map('intval', $this->game->plantCards->countCardsByLocationArgs('hand'));

                $this->bga->notify->player($playerId, "newHand", '', [
                    "cards" => $newHand,
                ]);
                $this->bga->notify->all("potatoExtraCards", clienttranslate('${player_name} drew 4 extra cards (Potato ability).'), [
                    "player_id" => $playerId,
                    "handCounts" => $handCounts,
                ]);
                break;

            case 'mushroom':
                // Give 1 Bonus Weather Card of each condition (sun / rain / wind),
                // moved from the public bonus deck into the player's public bonus
                // weather holdings (counted, not displayed as tiles — see
                // https://trello.com/c/uiJWdVTg).
                $given = [];
                foreach ([WeatherCards::CONDITION_SUN, WeatherCards::CONDITION_RAIN, WeatherCards::CONDITION_WIND] as $cond) {
                    $candidates = $this->game->weatherCards->getCardsOfTypeInLocation('bonus', $cond, 'bonus_deck');
                    if (!empty($candidates)) {
                        $cardId = (int)array_key_first($candidates);
                        $this->game->weatherCards->moveCard($cardId, 'weather_public_bonus', $playerId);
                        $given[] = $this->game->weatherCards->getCard($cardId);
                    }
                }
                // The claim just took up to 3 cards out of the shared bonus
                // market — broadcast the updated market so every client's
                // display stays in sync. See https://trello.com/c/uiJWdVTg.
                $bonusMarket = $this->game->weatherCards->getCardsOfTypeInLocation('bonus', null, 'bonus_deck');
                $this->bga->notify->all("mushroomBonusWeather", clienttranslate('${player_name} received 1 Bonus Weather Card of each type (Mushroom ability).'), [
                    "player_id" => $playerId,
                    "cards" => $given,
                    "bonusMarket" => $bonusMarket,
                ]);
                break;

            // 'carrot', 'tomato', 'banana' — no claim-time effect; their
            //  abilities trigger during the Planting Phase. Phase 2 / Phase 3.
        }
    }

    #[PossibleAction]
    public function actReturnCharacter(int $cardId)
    {
        $activePlayerId = (int)$this->game->getCurrentPlayerId();

        $card = $this->game->characterCards->getCard($cardId);
        if ($card['location'] !== 'garden' || (int)$card['location_arg'] !== $activePlayerId) {
            throw new UserException(clienttranslate("You can only return a character you have claimed."));
        }

        $this->game->characterCards->moveCard($cardId, 'deck');

        $this->bga->notify->all("characterReturned", clienttranslate('${player_name} returned the ${character_name} character.'), [
            "player_id" => $activePlayerId,
            "card" => $this->game->characterCards->getCard($cardId),
            "character_name" => Game::$CHARACTER_CARD_TYPES[$card['type']]['name']
        ]);
    }

    private function hasMulliganed(int $playerId): bool
    {
        $val = $this->game->getUniqueValueFromDb("SELECT player_mulligan_choice FROM player WHERE player_id = $playerId");
        return (int)$val > 0;
    }

    private function checkIfAllPlayersReady()
    {
        $players = $this->game->loadPlayersBasicInfos();
        $allReady = true;
        
        foreach ($players as $pId => $pInfo) {
            if (!$this->hasMulliganed($pId)) {
                $allReady = false;
                break;
            }
            $chars = $this->game->characterCards->getCardsInLocation('garden', $pId);
            if (count($chars) === 0) {
                $allReady = false;
                break;
            }
        }

        $playerId = (int)$this->game->getCurrentPlayerId();
        if ($allReady) {
            $this->game->gamestate->setPlayerNonMultiactive($playerId, DistributeWeather::class);
        } else {
            // Only deactivate the current player if they have completed BOTH required actions
            $playerReady = $this->hasMulliganed($playerId) && count($this->game->characterCards->getCardsInLocation('garden', $playerId)) > 0;
            if ($playerReady) {
                $this->game->gamestate->setPlayerNonMultiactive($playerId, '');
            }
        }
    }

    function zombie(int $playerId) {
        $this->game->DbQuery("UPDATE player SET player_mulligan_choice = 1 WHERE player_id = $playerId");
        // Zombie mode Level 0 ("The Passing Zombie" — see
        // https://en.doc.boardgamearena.com/Zombie_Mode): assign the
        // first available character, not an actually-random one. This
        // used to be commented as "random" — it isn't, array_values()[0]
        // is a deterministic pick, not a random draw. See
        // https://trello.com/c/5yFNTibV.
        $chars = $this->game->characterCards->getCardsInLocation('garden', $playerId);
        if (count($chars) === 0) {
            $deck = $this->game->characterCards->getCardsInLocation('deck');
            if (count($deck) > 0) {
                $card = array_values($deck)[0];
                $this->game->characterCards->moveCard($card['id'], 'garden', $playerId);
            }
        }
        $this->game->gamestate->setPlayerNonMultiactive($playerId, DistributeWeather::class);
    }
}
