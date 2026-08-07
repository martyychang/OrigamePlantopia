<?php

declare(strict_types=1);

namespace Bga\Games\Plantopia\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\UserException;
use Bga\Games\Plantopia\Game;
use Bga\Games\Plantopia\WeatherCards;

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
        // Reset any earlier skip decision — claiming a character after
        // having chosen to play without one (Trello W6iAfCBP) supersedes
        // that choice rather than leaving a stale flag behind.
        $this->game->DbQuery("UPDATE player SET player_skipped_character = 0 WHERE player_id = $activePlayerId");

        $this->bga->notify->all("characterClaimed", clienttranslate('${player_name} claimed the ${character_name} character.'), [
            "player_id" => $activePlayerId,
            "card" => $this->game->characterCards->getCard($cardId),
            "character_name" => Game::$CHARACTER_CARD_TYPES[$card['type']]['name']
        ]);

        $this->applyClaimAbility($activePlayerId, $card['type']);

        $this->checkIfAllPlayersReady();
    }

    /**
     * Character selection is optional (Trello W6iAfCBP): Daryl framed
     * characters as a "mini-expansion," and requiring one raises the
     * learning curve for new players unnecessarily. This lets a player
     * explicitly declare they're playing without one, rather than the
     * game silently treating "hasn't picked yet" and "picked to have
     * none" as the same thing.
     */
    #[PossibleAction]
    public function actSkipCharacter()
    {
        $activePlayerId = (int)$this->game->getCurrentPlayerId();

        if (!$this->hasMulliganed($activePlayerId)) {
            throw new UserException(clienttranslate("You must keep or redraw your hand first."));
        }

        $existing = $this->game->characterCards->getCardsInLocation('garden', $activePlayerId);
        if (count($existing) > 0) {
            throw new UserException(clienttranslate("You have already claimed a character. Return it first if you want to play without one."));
        }

        $this->game->DbQuery("UPDATE player SET player_skipped_character = 1 WHERE player_id = $activePlayerId");

        $this->bga->notify->all("characterSkipped", clienttranslate('${player_name} chose to play without a character.'), [
            "player_id" => $activePlayerId,
        ]);

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
        // Returning a character puts the player back to "undecided," not
        // "skipped" — they may still pick a different one or explicitly
        // skip via actSkipCharacter().

        $this->bga->notify->all("characterReturned", clienttranslate('${player_name} returned the ${character_name} character.'), [
            "player_id" => $activePlayerId,
            "card" => $this->game->characterCards->getCard($cardId),
            "character_name" => Game::$CHARACTER_CARD_TYPES[$card['type']]['name']
        ]);

        // Re-evaluate readiness: this action is only reachable while the
        // player is still active in this state, so it can never cause a
        // premature transition — but every other mutating action here
        // re-checks for consistency, and skipping it would be the odd one
        // out.
        $this->checkIfAllPlayersReady();
    }

    private function hasMulliganed(int $playerId): bool
    {
        $val = $this->game->getUniqueValueFromDb("SELECT player_mulligan_choice FROM player WHERE player_id = $playerId");
        return (int)$val > 0;
    }

    /**
     * True once a player has either claimed a character or explicitly
     * chosen to play without one (Trello W6iAfCBP). Claimed status is
     * derived from CharacterCards' own location data, not duplicated in
     * the skip column — the skip column only needs to capture the one
     * fact that isn't otherwise recorded anywhere.
     */
    private function hasCharacterDecision(int $playerId): bool
    {
        $chars = $this->game->characterCards->getCardsInLocation('garden', $playerId);
        if (count($chars) > 0) {
            return true;
        }
        $skipped = $this->game->getUniqueValueFromDb("SELECT player_skipped_character FROM player WHERE player_id = $playerId");
        return (int)$skipped > 0;
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
            if (!$this->hasCharacterDecision($pId)) {
                $allReady = false;
                break;
            }
        }

        $playerId = (int)$this->game->getCurrentPlayerId();
        if ($allReady) {
            $this->game->gamestate->setPlayerNonMultiactive($playerId, DistributeWeather::class);
        } else {
            // Only deactivate the current player if they have completed BOTH required actions
            $playerReady = $this->hasMulliganed($playerId) && $this->hasCharacterDecision($playerId);
            if ($playerReady) {
                $this->game->gamestate->setPlayerNonMultiactive($playerId, '');
            }
        }
    }

    function zombie(int $playerId) {
        $this->game->DbQuery("UPDATE player SET player_mulligan_choice = 1 WHERE player_id = $playerId");
        // Character selection is optional (Trello W6iAfCBP) — a
        // disconnected zombie player skips rather than being force-handed
        // a character they never chose. This replaces the old "assign the
        // first available character" behavior (see https://trello.com/c/5yFNTibV
        // for why that was a deterministic pick, not a random one, back
        // when a character was mandatory).
        $chars = $this->game->characterCards->getCardsInLocation('garden', $playerId);
        if (count($chars) === 0) {
            $this->game->DbQuery("UPDATE player SET player_skipped_character = 1 WHERE player_id = $playerId");
        }
        $this->game->gamestate->setPlayerNonMultiactive($playerId, DistributeWeather::class);
    }
}
