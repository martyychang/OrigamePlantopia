/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * OrigamePlantopia implementation : © <Your name here> <Your email address here>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 * 
 * In this file, you are describing the logic of your user interface, in Javascript language.
 *
 */

/**
 * We create one State class per declared state on the PHP side, to handle all state specific code here.
 * onEnteringState, onLeavingState and onPlayerActivationChange are predefined names that will be called by the framework.
 * When executing code in this state, you can access the args using this.args
 */
class SetupDecisions {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
    }

    onEnteringState(args, isCurrentPlayerActive) {
        if (!isCurrentPlayerActive) {
            this.bga.statusBar.setTitle(_('${actplayer} is making setup decisions'));
            return;
        }

        const isMulliganDone = this.game.gamedatas.players[this.bga.players.getCurrentPlayerId()].mulligan_choice > 0;

        if (!isMulliganDone) {
            this.bga.statusBar.setTitle(_('${you} may keep your starting hand or redraw once'));
            this.bga.statusBar.addActionButton(_('Keep Hand'), () => this.onKeepHand(), { color: 'blue' }); 
            this.bga.statusBar.addActionButton(_('Redraw (Once)'), () => this.onRedrawHand(), { color: 'red' }); 
            document.getElementById('characters-panel').style.display = 'none';
        } else {
            this.bga.statusBar.setTitle(_('${you} must select a character'));
            document.getElementById('characters-panel').style.display = 'block';

            // Highlight clickable characters in the Characters panel
            document.querySelectorAll('#characters-panel .character-card').forEach(el => {
                el.classList.add('bga-cards_selectable-card');
                el.style.cursor = 'pointer';
                el.style.boxShadow = '0 0 10px #f1c40f';
                el.onclick = () => this.onClaimCharacter(el.dataset.id);
            });

            // Highlight the player's own claimed character in their garden to return it
            const myGarden = document.getElementById(`player-garden-${this.bga.players.getCurrentPlayerId()}`);
            if (myGarden) {
                myGarden.querySelectorAll('.character-card').forEach(el => {
                    el.classList.add('bga-cards_selectable-card');
                    el.style.cursor = 'pointer';
                    el.style.boxShadow = '0 0 10px #e74c3c';
                    el.onclick = () => this.onReturnCharacter(el.dataset.id);
                });
            }
        }
    }

    onLeavingState(args, isCurrentPlayerActive) {
        // Clean up click handlers
        document.querySelectorAll('.character-card').forEach(el => {
            el.classList.remove('bga-cards_selectable-card');
            el.style.cursor = 'default';
            el.style.boxShadow = 'none';
            el.onclick = null;
        });
    }

    onKeepHand() {
        this.bga.actions.performAction("actKeep");
    }

    onRedrawHand() {
        this.bga.actions.performAction("actRedraw");
    }

    onClaimCharacter(cardId) {
        this.bga.actions.performAction("actClaimCharacter", { cardId });
    }

    onReturnCharacter(cardId) {
        this.bga.actions.performAction("actReturnCharacter", { cardId });
    }
}

class PlayerTurn {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
    }

    /**
     * This method is called each time we are entering the game state. You can use this method to perform some user interface changes at this moment.
     */
    onEnteringState(args, isCurrentPlayerActive) {
        this.bga.statusBar.setTitle(isCurrentPlayerActive ? 
            _('${you} must choose an option') :
            _('${actplayer} must choose an option')
        );
      
        if (isCurrentPlayerActive) {
            const playableCardsIds = args.playableCardsIds; // returned by the PlayerTurn::getArgs

            // Add test action buttons in the action status bar, simulating a card click:
            playableCardsIds.forEach(
                cardId => this.bga.statusBar.addActionButton(_('Play card with id ${card_id}').replace('${card_id}', cardId), () => this.onCardClick(cardId))
            ); 

            this.bga.statusBar.addActionButton(_('Pass'), () => this.bga.actions.performAction("actPass"), { color: 'secondary' }); 
        }
    }

    /**
     * This method is called each time we are leaving the game state. You can use this method to perform some user interface changes at this moment.
     */
    onLeavingState(args, isCurrentPlayerActive) {
    }

    /**
     * This method is called each time the current player becomes active or inactive in a MULTIPLE_ACTIVE_PLAYER state. You can use this method to perform some user interface changes at this moment.
     * on MULTIPLE_ACTIVE_PLAYER states, you may want to call this function in onEnteringState using `this.onPlayerActivationChange(args, isCurrentPlayerActive)` at the end of onEnteringState.
     * If your state is not a MULTIPLE_ACTIVE_PLAYER one, you can delete this function.
     */
    onPlayerActivationChange(args, isCurrentPlayerActive) {
    }

    
    onCardClick(card_id) {
        console.log( 'onCardClick', card_id );

        this.bga.actions.performAction("actPlayCard", { 
            card_id,
        }).then(() =>  {                
            // What to do after the server call if it succeeded
            // (most of the time, nothing, as the game will react to notifs / change of state instead, so you can delete the `then`)
        });        
    }
}

export class Game {
    constructor(bga) {
        console.log('origameplantopia constructor');
        this.bga = bga;

        // Declare the State classes
        this.setupDecisions = new SetupDecisions(this, bga);
        this.bga.states.register('SetupDecisions', this.setupDecisions);

        this.playerTurn = new PlayerTurn(this, bga);
        this.bga.states.register('PlayerTurn', this.playerTurn);

        // Uncomment the next line to show debug informations about state changes in the console. Remove before going to production!
        // this.bga.states.logger = console.log;
            
        // Here, you can init the global variables of your user interface
        // Example:
        // this.myGlobalValue = 0;
    }
    
    /*
        setup:
        
        This method must set up the game user interface according to current game situation specified
        in parameters.
        
        The method is called each time the game interface is displayed to a player, ie:
        _ when the game starts
        _ when a player refreshes the game page (F5)
        
        "gamedatas" argument contains all datas retrieved by your "getAllDatas" PHP method.
    */
    
    setup( gamedatas ) {
        console.log( "Starting game setup" );
        this.gamedatas = gamedatas;

        // Example to add a div on the game area
        this.bga.gameArea.getElement().insertAdjacentHTML('beforeend', `
            <div id="characters-panel" style="display: none; margin-bottom: 20px; border: 2px solid #8e44ad; border-radius: 8px; background: rgba(255, 255, 255, 0.9); padding: 15px;">
                <h3 style="color: #8e44ad; margin-top: 0;">Characters</h3>
                <div id="available-characters-container" style="display: flex; flex-wrap: wrap; gap: 15px;"></div>
            </div>
            <div id="player-tables"></div>
        `);
        
        // Render available characters
        this.renderCharacters(gamedatas.availableCharacters, 'available-characters-container');
        
        // Setting up player boards
        Object.values(gamedatas.players).forEach(player => {
            // example of setting up players boards
            this.bga.playerPanels.getElement(player.id).insertAdjacentHTML('beforeend', `
                <span id="energy-player-counter-${player.id}"></span> Energy
            `);
            const counter = new ebg.counter();
            counter.create(`energy-player-counter-${player.id}`, {
                value: player.energy,
                playerCounter: 'energy',
                playerId: player.id
            });

            // example of adding a div for each player
            document.getElementById('player-tables').insertAdjacentHTML('beforeend', `
                <div id="player-table-${player.id}" style="border: 1px solid #ccc; margin: 10px; padding: 10px; background: rgba(255,255,255,0.8); border-radius: 8px;">
                    <h3>${player.name}'s Garden</h3>
                    <div id="player-garden-${player.id}" style="display: flex; gap: 10px; margin-top: 10px; min-height: 150px;"></div>
                </div>
            `);

            // Render claimed characters for this player
            const claimed = Object.values(gamedatas.claimedCharacters || {}).filter(c => c.location_arg == player.id);
            this.renderCharacters(claimed, `player-garden-${player.id}`);
        });

        // Add a dedicated hand panel for the current player at the bottom (like RFTG)
        this.bga.gameArea.getElement().insertAdjacentHTML('beforeend', `
            <div id="hand_panel" style="margin-top: 20px; border: 2px solid #27ae60; border-radius: 8px; background: rgba(255, 255, 255, 0.9); padding: 15px;">
                <h3 style="color: #27ae60; margin-top: 0;">My Hand</h3>
                <div id="my-hand-container" style="display: flex; flex-wrap: wrap; gap: 15px;"></div>
            </div>
        `);

        // Setup the current player's hand
        this.renderHand(gamedatas.hand, gamedatas.weatherHand);
        
        // TODO: Set up your game interface here, according to "gamedatas"
        

        // Setup game notifications to handle (see "setupNotifications" method below)
        this.setupNotifications();

        console.log( "Ending game setup" );
    }

    ///////////////////////////////////////////////////
    //// Utility methods
    
    async notif_playerKeptCards(args) {
        this.gamedatas.players[args.player_id].mulligan_choice = 1;
        if (this.bga.states.getCurrentMainStateName() === 'SetupDecisions' && args.player_id == this.bga.players.getCurrentPlayerId()) {
            this.bga.statusBar.removeActionButtons();
            this.setupDecisions.onEnteringState(null, true);
        }
    }

    async notif_playerRedrewCards(args) {
        this.gamedatas.players[args.player_id].mulligan_choice = 2;
        if (this.bga.states.getCurrentMainStateName() === 'SetupDecisions' && args.player_id == this.bga.players.getCurrentPlayerId()) {
            this.bga.statusBar.removeActionButtons();
            this.setupDecisions.onEnteringState(null, true);
        }
    }
    
    /*
        You can add other notif_xxx methods here...that you can use everywhere in your javascript
        script. Typically, functions that are used in multiple state classes or outside a state class.
    */

    renderCharacters(cards, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        if (containerId === 'available-characters-container') {
            container.innerHTML = '';
        }

        if (!cards) return;
        
        Object.values(cards).forEach(card => {
            const cardInfo = this.gamedatas.characterCardTypes[card.type] || { name: card.type, ability: '' };
            container.insertAdjacentHTML('beforeend', `
                <div id="character_${card.id}" class="character-card" data-id="${card.id}" style="width: 140px; height: 180px; border: 2px solid #8e44ad; border-radius: 10px; padding: 10px; text-align: center; background: #f4ecf7; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 2px 2px 5px rgba(0,0,0,0.1); transition: transform 0.2s;">
                    <strong style="color: #8e44ad; font-size: 1.1em;">${cardInfo.name}</strong>
                    <div style="font-size: 0.75em; color: #34495e;">${cardInfo.ability}</div>
                </div>
            `);
        });
    }

    renderHand(handData, weatherHandData) {
        const handContainer = document.getElementById('my-hand-container');
        if (!handContainer) return;

        handContainer.innerHTML = ''; // Clear current hand
        
        if (handData) {
            Object.values(handData).forEach(card => {
                // Get the card name from the material data provided by getAllDatas
                const cardInfo = this.gamedatas.plantCardTypes[card.type] || { name: card.type };
                
                // Simple temporary HTML rendering for the card (simulating a BGA card component)
                handContainer.insertAdjacentHTML('beforeend', `
                    <div id="card_${card.id}" class="plant-card" style="width: 120px; height: 180px; border: 2px solid #2ecc71; border-radius: 10px; padding: 10px; text-align: center; background: #e8f8f5; display: flex; flex-direction: column; justify-content: center; box-shadow: 2px 2px 5px rgba(0,0,0,0.1); cursor: pointer; transition: transform 0.2s;">
                        <strong style="color: #27ae60; font-size: 1.1em;">${cardInfo.name}</strong>
                        <div style="margin-top: 10px; font-size: 0.8em; color: #7f8c8d;">${cardInfo.cost ? 'Cost: ' + cardInfo.cost : ''}</div>
                    </div>
                `);
            });
        }

        if (weatherHandData) {
            Object.values(weatherHandData).forEach(card => {
                let cardInfo = { name: card.type };
                if (this.gamedatas.weatherCardTypes[card.type] && this.gamedatas.weatherCardTypes[card.type].cards[card.type_arg]) {
                    cardInfo = this.gamedatas.weatherCardTypes[card.type].cards[card.type_arg];
                }

                handContainer.insertAdjacentHTML('beforeend', `
                    <div id="weather_${card.id}" class="weather-card" style="width: 120px; height: 180px; border: 2px solid #3498db; border-radius: 10px; padding: 10px; text-align: center; background: #ebf5fb; display: flex; flex-direction: column; justify-content: center; box-shadow: 2px 2px 5px rgba(0,0,0,0.1); cursor: pointer; transition: transform 0.2s;">
                        <strong style="color: #2980b9; font-size: 1.1em;">${cardInfo.name}</strong>
                    </div>
                `);
            });
        }

        // Add simple hover effect
        document.querySelectorAll('.plant-card, .weather-card').forEach(card => {
            card.addEventListener('mouseenter', () => card.style.transform = 'translateY(-10px)');
            card.addEventListener('mouseleave', () => card.style.transform = 'translateY(0)');
        });
    }

    ///////////////////////////////////////////////////
    //// Reaction to cometD notifications

    /*
        setupNotifications:
        
        In this method, you associate each of your game notifications with your local method to handle it.
        
        Note: game notification names correspond to "bga->notify->all" calls in your Game.php file.
    
    */
    setupNotifications() {
        console.log( 'notifications subscriptions setup' );
        
        // automatically listen to the notifications, based on the `notif_xxx` function on this class. 
        // Uncomment the logger param to see debug information in the console about notifications.
        this.bga.notifications.setupPromiseNotifications({
            // logger: console.log
        });
    }
    
    // TODO: from this point and below, you can write your game notifications handling methods
    
    async notif_newHand(args) {
        console.log("notif_newHand", args);
        // The server sends the new hand when the player redraws
        this.gamedatas.hand = args.cards;
        this.renderHand(this.gamedatas.hand, this.gamedatas.weatherHand);
    }
    
    async notif_characterClaimed(args) {
        const cardId = args.card.id;
        const cardEl = document.getElementById(`character_${cardId}`);
        if (cardEl) {
            const garden = document.getElementById(`player-garden-${args.player_id}`);
            if (garden) {
                garden.appendChild(cardEl);
                
                // Re-evaluate current state handlers (adds clickable return if it's ours)
                if (this.bga.states.getCurrentMainStateName() === 'SetupDecisions') {
                    this.setupDecisions.onEnteringState(null, this.bga.players.getCurrentPlayerId() === args.player_id);
                }
            }
        }
    }

    async notif_characterReturned(args) {
        const cardId = args.card.id;
        const cardEl = document.getElementById(`character_${cardId}`);
        if (cardEl) {
            const container = document.getElementById('available-characters-container');
            if (container) {
                container.appendChild(cardEl);

                // Re-evaluate current state handlers (adds clickable claim)
                if (this.bga.states.getCurrentMainStateName() === 'SetupDecisions') {
                    this.setupDecisions.onEnteringState(null, true);
                }
            }
        }
    }

    async notif_receivedWeatherCards(args) {
        if (!this.gamedatas.weatherHand) {
            this.gamedatas.weatherHand = {};
        }
        // Merge new weather cards
        Object.values(args.cards).forEach(c => {
            this.gamedatas.weatherHand[c.id] = c;
        });
        this.renderHand(this.gamedatas.hand, this.gamedatas.weatherHand);
    }
    
    /*
    Example:
    async notif_cardPlayed( args ) {
        // Note: args contains the arguments specified during you "notifyAllPlayers" / "notifyPlayer" PHP call
        
        // TODO: play the card in the user interface.
    }
    */
}
