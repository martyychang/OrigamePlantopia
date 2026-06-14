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
class InitialMulligan {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
    }

    onEnteringState(args, isCurrentPlayerActive) {
        this.bga.statusBar.setTitle(isCurrentPlayerActive ? 
            _('${you} may keep your starting hand or redraw once') :
            _('${actplayer} is deciding to keep or redraw')
        );
      
        if (isCurrentPlayerActive) {
            this.bga.statusBar.addActionButton(_('Keep Hand'), () => this.onKeepHand(), { color: 'blue' }); 
            this.bga.statusBar.addActionButton(_('Redraw (Once)'), () => this.onRedrawHand(), { color: 'red' }); 
        }
    }

    onLeavingState(args, isCurrentPlayerActive) {
    }

    onKeepHand() {
        this.bga.actions.performAction("actKeep");
    }

    onRedrawHand() {
        this.bga.actions.performAction("actRedraw");
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
        this.initialMulligan = new InitialMulligan(this, bga);
        this.bga.states.register('InitialMulligan', this.initialMulligan);

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
            <div id="player-tables"></div>
        `);
        
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
        });

        // Add a dedicated hand panel for the current player at the bottom (like RFTG)
        this.bga.gameArea.getElement().insertAdjacentHTML('beforeend', `
            <div id="hand_panel" style="margin-top: 20px; border: 2px solid #27ae60; border-radius: 8px; background: rgba(255, 255, 255, 0.9); padding: 15px;">
                <h3 style="color: #27ae60; margin-top: 0;">My Hand</h3>
                <div id="my-hand-container" style="display: flex; flex-wrap: wrap; gap: 15px;"></div>
            </div>
        `);

        // Setup the current player's hand
        this.renderHand(gamedatas.hand);
        
        // TODO: Set up your game interface here, according to "gamedatas"
        

        // Setup game notifications to handle (see "setupNotifications" method below)
        this.setupNotifications();

        console.log( "Ending game setup" );
    }

    ///////////////////////////////////////////////////
    //// Utility methods
    
    /*
        Here, you can defines some utility methods that you can use everywhere in your javascript
        script. Typically, functions that are used in multiple state classes or outside a state class.
    */

    renderHand(handData) {
        const handContainer = document.getElementById('my-hand-container');
        if (!handContainer) return;

        handContainer.innerHTML = ''; // Clear current hand
        
        if (!handData) return;
        
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

        // Add simple hover effect
        document.querySelectorAll('.plant-card').forEach(card => {
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
        this.renderHand(args.cards);
    }
    
    /*
    Example:
    async notif_cardPlayed( args ) {
        // Note: args contains the arguments specified during you "notifyAllPlayers" / "notifyPlayer" PHP call
        
        // TODO: play the card in the user interface.
    }
    */
}
