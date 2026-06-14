
-- ------
-- BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
-- OrigamePlantopia implementation : © Marty Chang
-- 
-- This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
-- See http://en.boardgamearena.com/#!doc/Studio for more information.
-- -----

-- Plant cards deck (102 cards, 32 unique types)
-- card_type = plant card name (e.g. 'Cattus', 'Boba Tree')
-- card_type_arg = 0 (unused, type is fully identified by name)
-- card_location = zone string (e.g. 'deck', 'hand', 'discard', 'garden_12345678')
-- card_location_arg = position within location (or player_id for 'hand')
CREATE TABLE IF NOT EXISTS `plant_card` (
  `card_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `card_type` VARCHAR(32) NOT NULL,
  `card_type_arg` INT NOT NULL,
  `card_location` VARCHAR(32) NOT NULL,
  `card_location_arg` INT NOT NULL,
  PRIMARY KEY (`card_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 AUTO_INCREMENT=1;

-- Weather cards deck (to be populated once weather card inventory is ready)
-- card_type = weather card name or type
-- card_location = zone string (e.g. 'deck', 'hand', 'discard', 'played')
CREATE TABLE IF NOT EXISTS `weather_card` (
  `card_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `card_type` VARCHAR(32) NOT NULL,
  `card_type_arg` INT NOT NULL,
  `card_location` VARCHAR(32) NOT NULL,
  `card_location_arg` INT NOT NULL,
  PRIMARY KEY (`card_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 AUTO_INCREMENT=1;
