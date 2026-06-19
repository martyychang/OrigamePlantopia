<?php
/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * OrigamePlantopia implementation : © Marty Chang
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * CharacterCards.php
 *
 * Material data for the 5 Character Cards.
 * Array keys match the Deck component's card_type values.
 */
declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia;

class CharacterCards
{
    public static function getTypes(): array
    {
        return [
            'banana' => [
                'name' => clienttranslate('Banana'),
                'ability' => clienttranslate('Discard 2 Baby Plants from hand to gain 1 planting action (max. 1 per round)'),
            ],
            'tomato' => [
                'name' => clienttranslate('Tomato'),
                'ability' => clienttranslate('Upon planting a Baby Plant, grow a matching Treevolved Plant by 1 Level.'),
            ],
            'potato' => [
                'name' => clienttranslate('Potato'),
                'ability' => clienttranslate('Start with 4 extra cards.'),
            ],
            'mushroom' => [
                'name' => clienttranslate('Mushroom'),
                'ability' => clienttranslate('Start with 1 Bonus Weather Card of each type.'),
            ],
            'carrot' => [
                'name' => clienttranslate('Carrot'),
                'ability' => clienttranslate('Upon treevolving, grow a Baby Plant by 1 Level.'),
            ],
        ];
    }

    /**
     * Build the array expected by Deck::createCards() from the material data.
     */
    public static function getDeckCards(): array
    {
        $cards = [];
        foreach (self::getTypes() as $character => $info) {
            $cards[] = [
                'type' => $character,
                'type_arg' => 0,
                'nbr' => 1,
            ];
        }
        return $cards;
    }
}
