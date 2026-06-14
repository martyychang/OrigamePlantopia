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
 * WeatherCards.php
 *
 * Material data for all 15 Character Weather Cards.
 * Array keys match the Deck component's card_type values.
 */
declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia;

class WeatherCards
{
    // Weather condition mapping for type_arg
    const CONDITION_SUN = 0;
    const CONDITION_RAIN = 1;
    const CONDITION_WIND = 2;

    public static function getTypes(): array
    {
        return [
            'banana' => [
                'name' => clienttranslate('Banana'),
                'cards' => [
                    self::CONDITION_SUN  => ['name' => clienttranslate('Banana Sun'), 'num_cards' => 1],
                    self::CONDITION_RAIN => ['name' => clienttranslate('Banana Rain'), 'num_cards' => 1],
                    self::CONDITION_WIND => ['name' => clienttranslate('Banana Wind'), 'num_cards' => 1],
                ]
            ],
            'tomato' => [
                'name' => clienttranslate('Tomato'),
                'cards' => [
                    self::CONDITION_SUN  => ['name' => clienttranslate('Tomato Sun'), 'num_cards' => 1],
                    self::CONDITION_RAIN => ['name' => clienttranslate('Tomato Rain'), 'num_cards' => 1],
                    self::CONDITION_WIND => ['name' => clienttranslate('Tomato Wind'), 'num_cards' => 1],
                ]
            ],
            'potato' => [
                'name' => clienttranslate('Potato'),
                'cards' => [
                    self::CONDITION_SUN  => ['name' => clienttranslate('Potato Sun'), 'num_cards' => 1],
                    self::CONDITION_RAIN => ['name' => clienttranslate('Potato Rain'), 'num_cards' => 1],
                    self::CONDITION_WIND => ['name' => clienttranslate('Potato Wind'), 'num_cards' => 1],
                ]
            ],
            'mushroom' => [
                'name' => clienttranslate('Mushroom'),
                'cards' => [
                    self::CONDITION_SUN  => ['name' => clienttranslate('Mushroom Sun'), 'num_cards' => 1],
                    self::CONDITION_RAIN => ['name' => clienttranslate('Mushroom Rain'), 'num_cards' => 1],
                    self::CONDITION_WIND => ['name' => clienttranslate('Mushroom Wind'), 'num_cards' => 1],
                ]
            ],
            'carrot' => [
                'name' => clienttranslate('Carrot'),
                'cards' => [
                    self::CONDITION_SUN  => ['name' => clienttranslate('Carrot Sun'), 'num_cards' => 1],
                    self::CONDITION_RAIN => ['name' => clienttranslate('Carrot Rain'), 'num_cards' => 1],
                    self::CONDITION_WIND => ['name' => clienttranslate('Carrot Wind'), 'num_cards' => 1],
                ]
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
            foreach ($info['cards'] as $condition => $cardInfo) {
                $cards[] = [
                    'type' => $character,
                    'type_arg' => $condition,
                    'nbr' => $cardInfo['num_cards'],
                ];
            }
        }
        return $cards;
    }

    /**
     * Get a specific card's information
     */
    public static function getCardInfo(string $character, int $condition): ?array
    {
        $types = self::getTypes();
        if (isset($types[$character]) && isset($types[$character]['cards'][$condition])) {
            return $types[$character]['cards'][$condition];
        }
        return null;
    }
}
