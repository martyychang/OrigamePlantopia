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
 * PlantCards.php
 *
 * Material data for all 33 unique plant card types (102 total cards).
 * Array keys match the Deck component's card_type values.
 */
declare(strict_types=1);

namespace Bga\Games\OrigamePlantopia;

class PlantCards
{
    // ── Plant type constants ────────────────────────────────────────────
    const BABY_CACTUS = 'baby_cactus';
    const BABY_FLOWER = 'baby_flower';
    const BABY_TREE   = 'baby_tree';
    const TRV_CACTUS  = 'trv_cactus';
    const TRV_FLOWER  = 'trv_flower';
    const TRV_TREE    = 'trv_tree';

    // ── Cost unit constants ─────────────────────────────────────────────
    const COST_CARD = 'card';
    // Treevolved cards use baby type constants as cost units (e.g. BABY_CACTUS)

    // ── Weather type constants ──────────────────────────────────────────
    const WEATHER_WIND = 'wind';
    const WEATHER_RAIN = 'rain';
    const WEATHER_SUN  = 'sun';
    const WEATHER_ANY  = 'any';

    // ── Level up target constants ───────────────────────────────────────
    const LEVEL_UP_ANY   = 'any_plant';
    const LEVEL_UP_OTHER = 'other_plant';
    const LEVEL_UP_THIS  = 'this_plant';
    const LEVEL_UP_BABY  = 'baby_plant';

    /**
     * All 6 plant type values, useful for iteration.
     */
    const ALL_TYPES = [
        self::BABY_CACTUS, self::BABY_FLOWER, self::BABY_TREE,
        self::TRV_CACTUS,  self::TRV_FLOWER,  self::TRV_TREE,
    ];

    /**
     * Return the full material data array for all 33 plant card types.
     *
     * Each entry is keyed by card name (= Deck card_type) and contains:
     *   name             string  Translatable display name
     *   plant_type       string  One of the plant type constants
     *   num_cards        int     How many copies exist in the deck
     *   cost             int     Planting cost amount
     *   cost_unit        string  What the cost is paid in (COST_CARD or a baby type)
     *   growth           array   [wind, rain, sun] weather needed to level up
     *   points_per_level int     VP scored per level on this plant
     *   flavor_text      string  Translatable flavor text
     *   planting_effect  array   One-time effect when planted (empty if none)
     *   bonus_scoring    array   End-game bonus VP rules (empty if none)
     */
    public static function getTypes(): array
    {
        return [
            // ════════════════════════════════════════════════════════════
            //  BABY CACTUS (4 unique, 20 total)
            // ════════════════════════════════════════════════════════════

            'Cattus' => [
                'name' => clienttranslate('Cattus'),
                'plant_type' => self::BABY_CACTUS,
                'num_cards' => 5,
                'cost' => 1,
                'cost_unit' => self::COST_CARD,
                'growth' => ['wind' => 0, 'rain' => 1, 'sun' => 1],
                'points_per_level' => 1,
                'flavor_text' => clienttranslate('Very purrickly.'),
                'card_effect' => clienttranslate('Immediately draw 5 cards and discard 4 cards.'),
                'planting_effect' => [
                    'draft_cards' => 5,
                    'keep_cards' => 1,
                ],
                'bonus_scoring' => [],
            ],

            'Cutetus' => [
                'name' => clienttranslate('Cutetus'),
                'plant_type' => self::BABY_CACTUS,
                'num_cards' => 5,
                'cost' => 1,
                'cost_unit' => self::COST_CARD,
                'growth' => ['wind' => 1, 'rain' => 0, 'sun' => 1],
                'points_per_level' => 1,
                'flavor_text' => clienttranslate('The cutest.'),
                'card_effect' => clienttranslate('Immediately draw 2 cards.'),
                'planting_effect' => [
                    'draw_cards' => 2,
                ],
                'bonus_scoring' => [],
            ],

            'Pointless Cactus' => [
                'name' => clienttranslate('Pointless Cactus'),
                'plant_type' => self::BABY_CACTUS,
                'num_cards' => 5,
                'cost' => 1,
                'cost_unit' => self::COST_CARD,
                'growth' => ['wind' => 0, 'rain' => 0, 'sun' => 2],
                'points_per_level' => 1,
                'flavor_text' => clienttranslate('Never gets to the point.'),
                'card_effect' => clienttranslate('Immediately draw 3 cards and discard 1 card.'),
                'planting_effect' => [
                    'draft_cards' => 3,
                    'keep_cards' => 2,
                ],
                'bonus_scoring' => [],
            ],

            'Sand Dollar Cactus' => [
                'name' => clienttranslate('Sand Dollar Cactus'),
                'plant_type' => self::BABY_CACTUS,
                'num_cards' => 5,
                'cost' => 2,
                'cost_unit' => self::COST_CARD,
                'growth' => ['wind' => 0, 'rain' => 0, 'sun' => 2],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('Sparkles like a star.'),
                'card_effect' => clienttranslate('Immediately draw 5 cards and discard 2 cards.'),
                'planting_effect' => [
                    'draft_cards' => 5,
                    'keep_cards' => 3,
                ],
                'bonus_scoring' => [],
            ],

            // ════════════════════════════════════════════════════════════
            //  BABY FLOWER (4 unique, 19 total)
            // ════════════════════════════════════════════════════════════

            'Buttercup' => [
                'name' => clienttranslate('Buttercup'),
                'plant_type' => self::BABY_FLOWER,
                'num_cards' => 4,
                'cost' => 0,
                'cost_unit' => self::COST_CARD,
                'growth' => ['wind' => 2, 'rain' => 0, 'sun' => 0],
                'points_per_level' => 1,
                'flavor_text' => clienttranslate('Blossoms among the bubbles.'),
                'card_effect' => clienttranslate('Immediately grow any plant by 2 levels.'),
                'planting_effect' => [
                    'level_up' => self::LEVEL_UP_ANY,
                    'level_up_qty' => 2,
                ],
                'bonus_scoring' => [],
            ],

            'Natural Flower' => [
                'name' => clienttranslate('Natural Flower'),
                'plant_type' => self::BABY_FLOWER,
                'num_cards' => 5,
                'cost' => 0,
                'cost_unit' => self::COST_CARD,
                'growth' => ['wind' => 1, 'rain' => 0, 'sun' => 1],
                'points_per_level' => 1,
                'flavor_text' => clienttranslate('This flower is neither sharp nor flat.'),
                'card_effect' => clienttranslate('Immediately grow a different plant by 1 level.'),
                'planting_effect' => [
                    'level_up' => self::LEVEL_UP_OTHER,
                ],
                'bonus_scoring' => [],
            ],

            'Twolips' => [
                'name' => clienttranslate('Twolips'),
                'plant_type' => self::BABY_FLOWER,
                'num_cards' => 5,
                'cost' => 0,
                'cost_unit' => self::COST_CARD,
                'growth' => ['wind' => 1, 'rain' => 1, 'sun' => 0],
                'points_per_level' => 1,
                'flavor_text' => clienttranslate('A pair of very talkative twins.'),
                'card_effect' => clienttranslate('Immediately grow itself by 2 levels.'),
                'planting_effect' => [
                    'level_up' => self::LEVEL_UP_THIS,
                    'level_up_qty' => 2,
                ],
                'bonus_scoring' => [],
            ],

            'Violet' => [
                'name' => clienttranslate('Violet'),
                'plant_type' => self::BABY_FLOWER,
                'num_cards' => 5,
                'cost' => 2,
                'cost_unit' => self::COST_CARD,
                'growth' => ['wind' => 2, 'rain' => 0, 'sun' => 0],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('A mini violin.'),
                'card_effect' => clienttranslate('Immediately grow all Trees/Flowers/Cacti (pick 1 type) by 1 Level.'),
                'planting_effect' => [
                    'level_up_family' => true,
                ],
                'bonus_scoring' => [],
            ],

            // ════════════════════════════════════════════════════════════
            //  BABY TREE (4 unique, 20 total)
            // ════════════════════════════════════════════════════════════

            'Gum Tree' => [
                'name' => clienttranslate('Gum Tree'),
                'plant_type' => self::BABY_TREE,
                'num_cards' => 5,
                'cost' => 2,
                'cost_unit' => self::COST_CARD,
                'growth' => ['wind' => 0, 'rain' => 2, 'sun' => 0],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('The origin of sticky tree sap.'),
                // Per the rulebook: "Immediately gain THE 2 Bonus Weather
                // Cards" — "the" refers to the two specific cards drawn on
                // the Gum Tree card art itself (a Bonus Rain Card and a
                // Bonus Sun Card), not a player's choice of any 2. Losing
                // that "the" in transcription (both here and in the
                // reference Google Doc) made it read as a generic
                // "gain any 2" grant instead. See https://trello.com/c/L56GTT7Q.
                'card_effect' => clienttranslate('Immediately gain a Bonus Rain Card and a Bonus Sun Card.'),
                'planting_effect' => [
                    // gain_weather_types (plural) is for a card that grants
                    // several DIFFERENT specific types in one effect — each
                    // becomes its own queued gain_weather entry (qty 1,
                    // that one type), auto-resolved with no player choice,
                    // same as any other single-type gain_weather effect
                    // (e.g. Pepper Tree's "gain a Bonus Wind Card"). Not to
                    // be confused with gain_weather_type (singular) +
                    // gain_weather_qty, which is for "gain N of [a single
                    // type / any type, player's choice]" (e.g. Geometree's
                    // "gain any Bonus Weather Card").
                    'gain_weather_types' => [self::WEATHER_RAIN, self::WEATHER_SUN],
                ],
                'bonus_scoring' => [],
            ],

            'Pepper Tree' => [
                'name' => clienttranslate('Pepper Tree'),
                'plant_type' => self::BABY_TREE,
                'num_cards' => 5,
                'cost' => 1,
                'cost_unit' => self::COST_CARD,
                'growth' => ['wind' => 0, 'rain' => 1, 'sun' => 1],
                'points_per_level' => 1,
                'flavor_text' => clienttranslate('Hot and spicy!'),
                'card_effect' => clienttranslate('Immediately gain a Bonus Wind card and gain 1 card.'),
                'planting_effect' => [
                    'gain_weather_qty' => 1,
                    'gain_weather_type' => self::WEATHER_WIND,
                    'draw_cards' => 1,
                ],
                'bonus_scoring' => [],
            ],

            'Tree Tree' => [
                'name' => clienttranslate('Tree Tree'),
                'plant_type' => self::BABY_TREE,
                'num_cards' => 5,
                'cost' => 1,
                'cost_unit' => self::COST_CARD,
                'growth' => ['wind' => 0, 'rain' => 2, 'sun' => 0],
                'points_per_level' => 1,
                'flavor_text' => clienttranslate("Money doesn't grow on trees. Trees grow on trees."),
                'card_effect' => clienttranslate('Immediately gain a Bonus Sun card and gain 1 card.'),
                'planting_effect' => [
                    'gain_weather_qty' => 1,
                    'gain_weather_type' => self::WEATHER_SUN,
                    'draw_cards' => 1,
                ],
                'bonus_scoring' => [],
            ],

            'Treegonometree' => [
                'name' => clienttranslate('Treegonometree'),
                'plant_type' => self::BABY_TREE,
                'num_cards' => 5,
                'cost' => 1,
                'cost_unit' => self::COST_CARD,
                'growth' => ['wind' => 1, 'rain' => 1, 'sun' => 0],
                'points_per_level' => 1,
                'flavor_text' => clienttranslate('A cute angel.'),
                'card_effect' => clienttranslate('Immediately gain a Bonus Rain card and gain 1 card.'),
                'planting_effect' => [
                    'gain_weather_qty' => 1,
                    'gain_weather_type' => self::WEATHER_RAIN,
                    'draw_cards' => 1,
                ],
                'bonus_scoring' => [],
            ],

            // ════════════════════════════════════════════════════════════
            //  TREEVOLVED CACTUS (7 unique, 15 total)
            // ════════════════════════════════════════════════════════════

            'Battus' => [
                'name' => clienttranslate('Battus'),
                'plant_type' => self::TRV_CACTUS,
                'num_cards' => 2,
                'cost' => 1,
                'cost_unit' => self::BABY_CACTUS,
                'growth' => ['wind' => 1, 'rain' => 1, 'sun' => 1],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('It drinks chlorophyll.'),
                'card_effect' => clienttranslate('Gain 1 Point per 2 cards in hand at the end of the game (including all Weather Cards).'),
                'planting_effect' => [],
                'bonus_scoring' => [
                    'per_two_cards_in_hand' => 1,
                ],
            ],

            'Bufftus' => [
                'name' => clienttranslate('Bufftus'),
                'plant_type' => self::TRV_CACTUS,
                'num_cards' => 2,
                'cost' => 3,
                'cost_unit' => self::BABY_CACTUS,
                'growth' => ['wind' => 0, 'rain' => 0, 'sun' => 3],
                'points_per_level' => 3,
                'flavor_text' => clienttranslate("Sun's out, guns out."),
                'card_effect' => clienttranslate('Gain 2 Points for every different plant type.'),
                'planting_effect' => [],
                'bonus_scoring' => [
                    'per_plant_type' => 2,
                ],
            ],

            'Cactie' => [
                'name' => clienttranslate('Cactie'),
                'plant_type' => self::TRV_CACTUS,
                'num_cards' => 3,
                'cost' => 2,
                'cost_unit' => self::BABY_CACTUS,
                'growth' => ['wind' => 0, 'rain' => 1, 'sun' => 2],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('Gotta go work. Not on leaf today.'),
                'card_effect' => clienttranslate('Gain 2 points for every Treevolved Cactus or Flower at the end of the game (itself included).'),
                'planting_effect' => [],
                'bonus_scoring' => [
                    'per_trv_cactus' => 2,
                    'per_trv_flower' => 2,
                ],
            ],

            'Captus' => [
                'name' => clienttranslate('Captus'),
                'plant_type' => self::TRV_CACTUS,
                'num_cards' => 2,
                'cost' => 2,
                'cost_unit' => self::BABY_CACTUS,
                'growth' => ['wind' => 1, 'rain' => 0, 'sun' => 2],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('It is safe to pat its head.'),
                'card_effect' => clienttranslate('Immediately carry out a Planting Phase action and draw 2 cards.'),
                'planting_effect' => [
                    'gain_action' => true,
                    'draw_cards' => 2,
                ],
                'bonus_scoring' => [],
            ],

            'Dogtus' => [
                'name' => clienttranslate('Dogtus'),
                'plant_type' => self::TRV_CACTUS,
                'num_cards' => 2,
                'cost' => 1,
                'cost_unit' => self::BABY_CACTUS,
                'growth' => ['wind' => 1, 'rain' => 0, 'sun' => 2],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('Always barking up the wrong tree.'),
                'card_effect' => clienttranslate('Treat this plant as being 2 Treevolved Cacti for the purpose of end-game scoring.'),
                'planting_effect' => [],
                'treat_as' => [self::TRV_CACTUS => 2],
                'bonus_scoring' => [],
            ],

            'Suckulent' => [
                'name' => clienttranslate('Suckulent'),
                'plant_type' => self::TRV_CACTUS,
                'num_cards' => 2,
                'cost' => 3,
                'cost_unit' => self::BABY_CACTUS,
                'growth' => ['wind' => 0, 'rain' => 1, 'sun' => 2],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('Its favorite drink is Ulent.'),
                'card_effect' => clienttranslate('Gain 2 points for every level 3 plant at the end of the game (itself included).'),
                'planting_effect' => [],
                'bonus_scoring' => [
                    'per_level3' => 2,
                ],
            ],

            'Thornos' => [
                'name' => clienttranslate('Thornos'),
                'plant_type' => self::TRV_CACTUS,
                'num_cards' => 2,
                'cost' => 3,
                'cost_unit' => self::BABY_CACTUS,
                'growth' => ['wind' => 0, 'rain' => 0, 'sun' => 3],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('Grows well in stony places.'),
                'card_effect' => clienttranslate('Gain 2 points for every Baby and Treevolved Cactus at the end of the game (itself included).'),
                'planting_effect' => [],
                'bonus_scoring' => [
                    'per_baby_cactus' => 2,
                    'per_trv_cactus' => 2,
                ],
            ],

            // ════════════════════════════════════════════════════════════
            //  TREEVOLVED FLOWER (7 unique, 14 total)
            // ════════════════════════════════════════════════════════════

            'Arrowhead' => [
                'name' => clienttranslate('Arrowhead'),
                'plant_type' => self::TRV_FLOWER,
                'num_cards' => 2,
                'cost' => 2,
                'cost_unit' => self::BABY_FLOWER,
                'growth' => ['wind' => 2, 'rain' => 1, 'sun' => 0],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('Full of good pointers, unlike Pointless Cactus.'),
                'card_effect' => clienttranslate('Immediately carry out a Planting Phase action and grow any plant by 1 Level.'),
                'planting_effect' => [
                    'gain_action' => true,
                    'level_up' => self::LEVEL_UP_ANY,
                    'level_up_qty' => 1,
                ],
                'bonus_scoring' => [],
            ],

            'Call-A-Lily' => [
                'name' => clienttranslate('Call-A-Lily'),
                'plant_type' => self::TRV_FLOWER,
                'num_cards' => 2,
                'cost' => 3,
                'cost_unit' => self::BABY_FLOWER,
                'growth' => ['wind' => 3, 'rain' => 0, 'sun' => 0],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('Hello? Lily?'),
                'card_effect' => clienttranslate('Gain 2 points for every Baby and Treevolved Flower at the end of the game (itself included).'),
                'planting_effect' => [],
                'bonus_scoring' => [
                    'per_baby_flower' => 2,
                    'per_trv_flower' => 2,
                ],
            ],

            'Carnation' => [
                'name' => clienttranslate('Carnation'),
                'plant_type' => self::TRV_FLOWER,
                'num_cards' => 2,
                'cost' => 2,
                'cost_unit' => self::BABY_FLOWER,
                'growth' => ['wind' => 2, 'rain' => 0, 'sun' => 1],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('A country of many cars.'),
                'card_effect' => clienttranslate('Gain 2 points for every Treevolved Flower or Tree at the end of the game (itself included).'),
                'planting_effect' => [],
                'bonus_scoring' => [
                    'per_trv_tree' => 2,
                    'per_trv_flower' => 2,
                ],
            ],

            'Firecracker Flower' => [
                'name' => clienttranslate('Firecracker Flower'),
                'plant_type' => self::TRV_FLOWER,
                'num_cards' => 2,
                'cost' => 3,
                'cost_unit' => self::BABY_FLOWER,
                'growth' => ['wind' => 3, 'rain' => 0, 'sun' => 0],
                'points_per_level' => 3,
                'flavor_text' => clienttranslate('Explosive seed dispersal.'),
                'card_effect' => clienttranslate('Gain 2 Points for every different plant type.'),
                'planting_effect' => [],
                'bonus_scoring' => [
                    'per_plant_type' => 2,
                ],
            ],

            'Lily-of-the-Rainbow' => [
                'name' => clienttranslate('Lily-of-the-Rainbow'),
                'plant_type' => self::TRV_FLOWER,
                'num_cards' => 2,
                'cost' => 3,
                'cost_unit' => self::BABY_FLOWER,
                'growth' => ['wind' => 2, 'rain' => 0, 'sun' => 1],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('Found on a valley under a rainbow.'),
                'card_effect' => clienttranslate('Gain 2 points for every level 3 plant at the end of the game (itself included).'),
                'planting_effect' => [],
                'bonus_scoring' => [
                    'per_level3' => 2,
                ],
            ],

            'Money Plant' => [
                'name' => clienttranslate('Money Plant'),
                'plant_type' => self::TRV_FLOWER,
                'num_cards' => 2,
                'cost' => 1,
                'cost_unit' => self::BABY_FLOWER,
                'growth' => ['wind' => 1, 'rain' => 1, 'sun' => 1],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate("Money doesn't grow on trees. They grow as flowers."),
                'card_effect' => clienttranslate('Gain 1 Point per 2 cards in hand at the end of the game (including all Weather Cards).'),
                'planting_effect' => [],
                'bonus_scoring' => [
                    'per_two_cards_in_hand' => 1,
                ],
            ],

            'Potted Planted Potted Plants' => [
                'name' => clienttranslate('Potted Planted Potted Plants'),
                'plant_type' => self::TRV_FLOWER,
                'num_cards' => 2,
                'cost' => 1,
                'cost_unit' => self::BABY_FLOWER,
                'growth' => ['wind' => 2, 'rain' => 1, 'sun' => 0],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('This is not even its final form.'),
                'card_effect' => clienttranslate('Treat this plant as being 2 Treevolved Flowers for the purpose of end-game scoring.'),
                'planting_effect' => [],
                'treat_as' => [self::TRV_FLOWER => 2],
                'bonus_scoring' => [],
            ],

            // ════════════════════════════════════════════════════════════
            //  TREEVOLVED TREE (7 unique, 14 total)
            // ════════════════════════════════════════════════════════════

            'Boba Tree' => [
                'name' => clienttranslate('Boba Tree'),
                'plant_type' => self::TRV_TREE,
                'num_cards' => 2,
                'cost' => 3,
                'cost_unit' => self::BABY_TREE,
                'growth' => ['wind' => 0, 'rain' => 3, 'sun' => 0],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('Grown from organic boba pearls.'),
                'card_effect' => clienttranslate('Gain 2 points for every Baby and Treevolved Tree at the end of the game (itself included).'),
                'planting_effect' => [],
                'bonus_scoring' => [
                    'per_baby_tree' => 2,
                    'per_trv_tree' => 2,
                ],
            ],

            'Geometree' => [
                'name' => clienttranslate('Geometree'),
                'plant_type' => self::TRV_TREE,
                'num_cards' => 2,
                'cost' => 2,
                'cost_unit' => self::BABY_TREE,
                'growth' => ['wind' => 0, 'rain' => 2, 'sun' => 1],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('Support the use of tractors in farming! Be pro-tractor!'),
                'card_effect' => clienttranslate('Immediately carry out a Planting Phase action and gain any Bonus Weather Card.'),
                'planting_effect' => [
                    'gain_action' => true,
                    'gain_weather_qty' => 1,
                    'gain_weather_type' => self::WEATHER_ANY,
                ],
                'bonus_scoring' => [],
            ],

            'Impossible Tree' => [
                'name' => clienttranslate('Impossible Tree'),
                'plant_type' => self::TRV_TREE,
                'num_cards' => 2,
                'cost' => 2,
                'cost_unit' => self::BABY_TREE,
                'growth' => ['wind' => 1, 'rain' => 2, 'sun' => 0],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('A species discovered by MC Treescher.'),
                'card_effect' => clienttranslate('Gain 2 points for every Treevolved Cactus or Tree at the end of the game (itself included).'),
                'planting_effect' => [],
                'bonus_scoring' => [
                    'per_trv_cactus' => 2,
                    'per_trv_tree' => 2,
                ],
            ],

            'Monte Carlo Tree' => [
                'name' => clienttranslate('Monte Carlo Tree'),
                'plant_type' => self::TRV_TREE,
                'num_cards' => 2,
                'cost' => 1,
                'cost_unit' => self::BABY_TREE,
                'growth' => ['wind' => 1, 'rain' => 1, 'sun' => 1],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('DeepVine Artreeficial Intelleafgence. Its favorite game is Go.'),
                'card_effect' => clienttranslate('Gain 1 Point per 2 cards in hand at the end of the game (including all Weather Cards).'),
                'planting_effect' => [],
                'bonus_scoring' => [
                    'per_two_cards_in_hand' => 1,
                ],
            ],

            'Square Root of Tree' => [
                'name' => clienttranslate('Square Root of Tree'),
                'plant_type' => self::TRV_TREE,
                'num_cards' => 2,
                'cost' => 3,
                'cost_unit' => self::BABY_TREE,
                'growth' => ['wind' => 1, 'rain' => 2, 'sun' => 0],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('Sometimes behaves irrationally.'),
                'card_effect' => clienttranslate('Gain 2 points for every level 3 plant at the end of the game (itself included).'),
                'planting_effect' => [],
                'bonus_scoring' => [
                    'per_level3' => 2,
                ],
            ],

            'Symmetree' => [
                'name' => clienttranslate('Symmetree'),
                'plant_type' => self::TRV_TREE,
                'num_cards' => 2,
                'cost' => 1,
                'cost_unit' => self::BABY_TREE,
                'growth' => ['wind' => 0, 'rain' => 2, 'sun' => 1],
                'points_per_level' => 2,
                'flavor_text' => clienttranslate('We stand for fairness and treequality.'),
                'card_effect' => clienttranslate('Treat this plant as being 2 Treevolved Trees for the purpose of end-game scoring.'),
                'planting_effect' => [],
                'treat_as' => [self::TRV_TREE => 2],
                'bonus_scoring' => [],
            ],

            'Treenity' => [
                'name' => clienttranslate('Treenity'),
                'plant_type' => self::TRV_TREE,
                'num_cards' => 2,
                'cost' => 3,
                'cost_unit' => self::BABY_TREE,
                'growth' => ['wind' => 0, 'rain' => 3, 'sun' => 0],
                'points_per_level' => 3,
                'flavor_text' => clienttranslate('Thrives on holy water.'),
                'card_effect' => clienttranslate('Gain 2 Points for every different plant type.'),
                'planting_effect' => [],
                'bonus_scoring' => [
                    'per_plant_type' => 2,
                ],
            ],
        ];
    }

    // ── Helper methods ──────────────────────────────────────────────────

    /**
     * Build the array expected by Deck::createCards() from the material data.
     * Returns [['type' => 'Cattus', 'type_arg' => 0, 'nbr' => 5], ...]
     */
    public static function getDeckCards(): array
    {
        $cards = [];
        foreach (self::getTypes() as $name => $info) {
            $cards[] = [
                'type' => $name,
                'type_arg' => 0,
                'nbr' => $info['num_cards'],
            ];
        }
        return $cards;
    }

    /**
     * Resolve a string that may be either a card_type (card name like
     * 'Cattus') or a plant_type constant (like 'baby_cactus') to its
     * plant_type constant. Returns null if the input is neither.
     *
     * BGA Deck stores the card NAME in the card_type column, so $card['type']
     * is 'Cattus' — not 'baby_cactus'. Callers that pass card['type'] directly
     * into isBaby()/isTreevolved() would otherwise silently always get false.
     */
    public static function resolvePlantType(string $input): ?string
    {
        if (in_array($input, self::ALL_TYPES, true)) {
            return $input;
        }
        $types = self::getTypes();
        return $types[$input]['plant_type'] ?? null;
    }

    /**
     * Check if a plant is a Baby plant. Accepts either a card name
     * (e.g. 'Cattus') or a plant_type constant (e.g. self::BABY_CACTUS).
     */
    public static function isBaby(string $cardOrType): bool
    {
        $plantType = self::resolvePlantType($cardOrType);
        return $plantType !== null
            && in_array($plantType, [self::BABY_CACTUS, self::BABY_FLOWER, self::BABY_TREE], true);
    }

    /**
     * Check if a plant is a Treevolved plant. Accepts either a card name
     * or a plant_type constant.
     */
    public static function isTreevolved(string $cardOrType): bool
    {
        $plantType = self::resolvePlantType($cardOrType);
        return $plantType !== null
            && in_array($plantType, [self::TRV_CACTUS, self::TRV_FLOWER, self::TRV_TREE], true);
    }

    /**
     * Get the family name (cactus, flower, tree) for a plant type.
     */
    public static function getFamily(string $plantType): string
    {
        return match ($plantType) {
            self::BABY_CACTUS, self::TRV_CACTUS => 'cactus',
            self::BABY_FLOWER, self::TRV_FLOWER => 'flower',
            self::BABY_TREE,   self::TRV_TREE   => 'tree',
        };
    }

    /**
     * Get the Baby type that a Treevolved type evolves from.
     */
    public static function getBabyType(string $trvType): string
    {
        return match ($trvType) {
            self::TRV_CACTUS => self::BABY_CACTUS,
            self::TRV_FLOWER => self::BABY_FLOWER,
            self::TRV_TREE   => self::BABY_TREE,
            default => throw new \InvalidArgumentException("Not a treevolved type: $trvType"),
        };
    }
}
