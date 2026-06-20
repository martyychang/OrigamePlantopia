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
        this.onPlayerActivationChange(args, isCurrentPlayerActive);
    }

    onPlayerActivationChange(args, isCurrentPlayerActive) {
        this.bga.statusBar.removeActionButtons();
        
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

class PlantingPhase {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
        this.selectedAction = null;
        this.selectedCardToPlant = null;
        this.selectedPlanter = null;
        this.selectedPaymentCards = [];
        this.selectedPlantToGrow = null;
    }

    onEnteringState(args, isCurrentPlayerActive) {
        if (args && args.planting_statuses) {
            Object.entries(args.planting_statuses).forEach(([pId, status]) => {
                if (this.game.gamedatas.players[pId]) {
                    this.game.gamedatas.players[pId].planting_status = status;
                }
            });
        }
        this.onPlayerActivationChange(args, isCurrentPlayerActive);
    }

    onPlayerActivationChange(args, isCurrentPlayerActive) {
        this.bga.statusBar.removeActionButtons();

        if (!isCurrentPlayerActive) {
            this.bga.statusBar.setTitle(_('Waiting for other players to finish Planting...'));
            return;
        }

        const player = this.game.gamedatas.players[this.bga.players.getCurrentPlayerId()];
        const status = player.planting_status;
        
        if (status == 1) {
            this.bga.statusBar.setTitle(_('Waiting for other players to finish Planting...'));
        } else if (status == 2 || status == 3) {
            let pending = [];
            try { pending = JSON.parse(player.pending_effects || '[]'); } catch(e) {}
            if (pending.length > 0) {
                this.renderPendingEffect(pending[0]);
            } else {
                this.bga.statusBar.setTitle(_('Resolving effects...'));
            }
        } else {
            this.resetSelection();
            this.updateStatusBar();
        }
    }

    onLeavingState(args, isCurrentPlayerActive) {
        this.cleanupUI();
    }

    resetSelection() {
        this.selectedAction = null;
        this.selectedCardToPlant = null;
        this.selectedPlanter = null;
        this.selectedPaymentCards = [];
        this.selectedPlantToGrow = null;
        this.cleanupUI();
    }

    cleanupUI() {
        document.querySelectorAll('.bga-cards_selectable-card').forEach(el => {
            el.classList.remove('bga-cards_selectable-card');
            el.style.boxShadow = 'none';
            el.onclick = null;
        });
        const draftContainer = document.getElementById('draft-container');
        if (draftContainer) draftContainer.remove();
    }

    updateStatusBar() {
        this.bga.statusBar.removeActionButtons();

        if (!this.selectedAction) {
            this.bga.statusBar.setTitle(_('${you} must choose a planting action'));
            this.bga.statusBar.addActionButton(_('Plant'), () => this.startAction('plant'), { color: 'blue' });
            this.bga.statusBar.addActionButton(_('Grow'), () => this.startAction('grow'), { color: 'green' });
            this.bga.statusBar.addActionButton(_('Draw 5 (Keep 2)'), () => this.startAction('draw5'), { color: 'blue' });
        } else if (this.selectedAction === 'plant') {
            this.bga.statusBar.addActionButton(_('Cancel'), () => { this.resetSelection(); this.updateStatusBar(); }, { color: 'gray' });
            
            if (!this.selectedCardToPlant) {
                this.bga.statusBar.setTitle(_('Select a plant card from your hand to plant'));
                this.highlightHandCardsForSelection(id => {
                    this.selectedCardToPlant = id;
                    this.updateStatusBar();
                });
            } else if (!this.selectedPlanter) {
                this.bga.statusBar.setTitle(_('Select an empty planter in your garden'));
                this.highlightEmptyPlanters(id => {
                    this.selectedPlanter = id;
                    this.updateStatusBar();
                });
            } else {
                const cardInfo = this.game.gamedatas.plantCardTypes[this.game.gamedatas.hand[this.selectedCardToPlant].type];
                const cost = cardInfo.cost;
                
                if (this.isBaby(cardInfo.plant_type)) {
                    if (this.selectedPaymentCards.length < cost) {
                        this.bga.statusBar.setTitle(_('Select ${cost} more card(s) to discard as cost').replace('${cost}', cost - this.selectedPaymentCards.length));
                        this.highlightHandCardsForCost(id => {
                            if (!this.selectedPaymentCards.includes(id)) {
                                this.selectedPaymentCards.push(id);
                                this.updateStatusBar();
                            }
                        });
                    } else {
                        this.confirmPlant();
                    }
                } else {
                    // Treevolved plant - need to select a plant to sacrifice
                    if (this.selectedPaymentCards.length < 1) {
                        this.bga.statusBar.setTitle(_('Select a plant in your garden to treevolve (sacrifice)'));
                        this.highlightGardenPlantsForCost(id => {
                            this.selectedPaymentCards = [id];
                            this.updateStatusBar();
                        }, cardInfo);
                    } else {
                        this.confirmPlant();
                    }
                }
            }
        } else if (this.selectedAction === 'grow') {
            this.bga.statusBar.addActionButton(_('Cancel'), () => { this.resetSelection(); this.updateStatusBar(); }, { color: 'gray' });
            
            if (!this.selectedPlantToGrow) {
                this.bga.statusBar.setTitle(_('Select a plant in your garden to grow'));
                this.highlightPlantsToGrow(id => {
                    this.selectedPlantToGrow = id;
                    this.updateStatusBar();
                });
            } else {
                let pCardInfo = this.game.getPlantCard(this.selectedPlantToGrow);
                const cost = this.game.gamedatas.plantCardTypes[pCardInfo.type].cost;
                
                if (this.selectedPaymentCards.length < cost) {
                    this.bga.statusBar.setTitle(_('Select ${cost} more card(s) to discard as fertilizer').replace('${cost}', cost - this.selectedPaymentCards.length));
                    this.highlightHandCardsForCost(id => {
                        if (!this.selectedPaymentCards.includes(id)) {
                            this.selectedPaymentCards.push(id);
                            this.updateStatusBar();
                        }
                    });
                } else {
                    this.bga.statusBar.setTitle(_('Confirm Growth'));
                    this.bga.statusBar.addActionButton(_('Confirm'), () => this.confirmGrow(), { color: 'green' });
                }
            }
        }
    }

    startAction(action) {
        if (action === 'draw5') {
            this.bga.actions.performAction("actRequestDraw5");
        } else {
            this.selectedAction = action;
            this.updateStatusBar();
        }
    }

    highlightHandCardsForSelection(callback) {
        this.cleanupUI();
        const hand = this.game.gamedatas.hand;
        Object.values(hand).forEach(c => {
            const el = document.getElementById(`card_${c.id}`);
            if (el) {
                el.classList.add('bga-cards_selectable-card');
                el.style.boxShadow = '0 0 10px #27ae60';
                el.onclick = () => callback(c.id);
            }
        });
    }

    highlightEmptyPlanters(callback) {
        this.cleanupUI();
        const pId = this.bga.players.getCurrentPlayerId();
        const planters = Object.values(this.game.gamedatas.planters).filter(p => p.location_arg == pId);
        
        planters.forEach(p => {
            // Check if empty
            const plantsOnIt = Object.values(this.game.gamedatas.plantsOnPlanters || {}).filter(pl => pl.location_arg == p.id);
            if (plantsOnIt.length === 0) {
                const el = document.getElementById(`planter_${p.id}`);
                if (el) {
                    el.classList.add('bga-cards_selectable-card');
                    el.style.boxShadow = '0 0 10px #f1c40f';
                    el.onclick = () => callback(p.id);
                }
            }
        });
    }

    highlightHandCardsForCost(callback) {
        this.cleanupUI();
        const hand = this.game.gamedatas.hand;
        Object.values(hand).forEach(c => {
            if (c.id != this.selectedCardToPlant && !this.selectedPaymentCards.includes(c.id)) {
                const el = document.getElementById(`card_${c.id}`);
                if (el) {
                    el.classList.add('bga-cards_selectable-card');
                    el.style.boxShadow = '0 0 10px #e74c3c';
                    el.onclick = () => callback(c.id);
                }
            }
        });
    }

    highlightGardenPlantsForCost(callback, trvCardInfo) {
        this.cleanupUI();
        const pId = this.bga.players.getCurrentPlayerId();
        const allPlants = [
            ...Object.values(this.game.gamedatas.plantsOnPlanters || {}).filter(pl => {
                const planter = this.game.gamedatas.planters[pl.location_arg];
                return planter && planter.location_arg == pId;
            }),
            ...Object.values(this.game.gamedatas.plantsLevel3 || {}).filter(pl => pl.location_arg == pId)
        ];

        allPlants.forEach(pl => {
            const typeInfo = this.game.gamedatas.plantCardTypes[pl.type];
            if (pl.type_arg >= trvCardInfo.cost && this.game.getFamily(typeInfo.plant_type) === this.game.getFamily(trvCardInfo.cost_unit)) {
                const el = document.getElementById(`garden_plant_${pl.id}`);
                if (el) {
                    el.classList.add('bga-cards_selectable-card');
                    el.style.boxShadow = '0 0 10px #e74c3c';
                    el.onclick = () => callback(pl.id);
                }
            }
        });
    }

    highlightPlantsToGrow(callback) {
        this.cleanupUI();
        const pId = this.bga.players.getCurrentPlayerId();
        const plants = Object.values(this.game.gamedatas.plantsOnPlanters || {}).filter(pl => {
            const planter = this.game.gamedatas.planters[pl.location_arg];
            return planter && planter.location_arg == pId && pl.type_arg < 3;
        });

        plants.forEach(pl => {
            const el = document.getElementById(`garden_plant_${pl.id}`);
            if (el) {
                el.classList.add('bga-cards_selectable-card');
                el.style.boxShadow = '0 0 10px #27ae60';
                el.onclick = () => callback(pl.id);
            }
        });
    }

    isBaby(plantType) {
        return ['baby_cactus', 'baby_flower', 'baby_tree'].includes(plantType);
    }

    confirmPlant() {
        this.bga.actions.performAction("actPlant", { 
            cardId: this.selectedCardToPlant,
            planterCardId: this.selectedPlanter,
            paymentCardIds: this.selectedPaymentCards.join(';')
        });
    }

    confirmGrow() {
        this.bga.actions.performAction("actGrow", {
            plantCardId: this.selectedPlantToGrow,
            paymentCardIds: this.selectedPaymentCards.join(';')
        });
    }

    renderPendingEffect(effect) {
        this.resetSelection();
        this.selectedPaymentCards = [];
        
        if (effect.type === 'draft_cards') {
            this.bga.statusBar.setTitle(_('Choose ${keep} card(s) to keep').replace('${keep}', effect.keep));
            this.renderDraftModal(effect.keep);
        } else if (effect.type === 'discard_cards') {
            this.bga.statusBar.setTitle(_('Discard ${qty} card(s) from your hand').replace('${qty}', effect.qty));
            this.highlightHandCardsForSelection(id => {
                if (this.selectedPaymentCards.includes(id)) {
                    this.selectedPaymentCards = this.selectedPaymentCards.filter(c => c !== id);
                    document.getElementById(`card_${id}`).style.boxShadow = '0 0 10px #e74c3c';
                } else {
                    this.selectedPaymentCards.push(id);
                    document.getElementById(`card_${id}`).style.boxShadow = '0 0 10px #2ecc71';
                }
                
                this.bga.statusBar.removeActionButtons();
                if (this.selectedPaymentCards.length === effect.qty || this.selectedPaymentCards.length === Object.keys(this.game.gamedatas.hand).length) {
                    this.bga.statusBar.addActionButton(_('Confirm Discard'), () => {
                        this.bga.actions.performAction("actResolveDiscard", { cardIdsStr: this.selectedPaymentCards.join(';') });
                    }, { color: 'red' });
                }
            });
            // Initial highlight
            Object.values(this.game.gamedatas.hand).forEach(c => {
                const el = document.getElementById(`card_${c.id}`);
                if (el) el.style.boxShadow = '0 0 10px #e74c3c';
            });
        } else if (effect.type === 'gain_weather') {
            this.bga.statusBar.setTitle(_('Choose a Bonus Weather card to gain'));
            document.querySelectorAll('#bonus-weather-container .weather-card').forEach(el => {
                el.classList.add('bga-cards_selectable-card');
                el.style.boxShadow = '0 0 10px #f1c40f';
                el.style.cursor = 'pointer';
                el.onclick = () => {
                    this.bga.actions.performAction("actResolveGainWeather", { cardId: el.dataset.id });
                };
            });
        } else if (effect.type === 'level_up') {
            this.bga.statusBar.setTitle(_('Choose a plant in your garden to grow'));
            this.highlightPlantsToGrow(id => {
                this.bga.actions.performAction("actResolveLevelUp", { plantCardId: id });
            });
        } else if (effect.type === 'level_up_family') {
            this.bga.statusBar.setTitle(_('Choose a plant family to grow'));
            this.bga.statusBar.addActionButton(_('Tree'), () => this.bga.actions.performAction("actResolveLevelUpFamily", { family: 'tree' }), { color: 'green' });
            this.bga.statusBar.addActionButton(_('Flower'), () => this.bga.actions.performAction("actResolveLevelUpFamily", { family: 'flower' }), { color: 'red' });
            this.bga.statusBar.addActionButton(_('Cactus'), () => this.bga.actions.performAction("actResolveLevelUpFamily", { family: 'cactus' }), { color: 'blue' });
        } else if (effect.type === 'level_up_matching_adult') {
            // Tomato character ability — grow a matching-family Adult Plant in
            // the player's garden by 1 level. The server validates that the
            // chosen plant is an Adult of the right family; the player picks
            // the target from their garden plants.
            const familyLabel = effect.family
                ? effect.family.charAt(0).toUpperCase() + effect.family.slice(1)
                : '';
            this.bga.statusBar.setTitle(
                _('Choose an Adult ${family} plant in your garden to grow (Tomato ability)')
                    .replace('${family}', familyLabel)
            );
            this.highlightPlantsToGrow(id => {
                this.bga.actions.performAction("actResolveLevelUpMatchingAdult", { plantCardId: id });
            });
        } else if (effect.type === 'banana_offer') {
            // Banana character ability — after the normal Planting Phase
            // action completes, optionally discard 2 Baby Plants from hand
            // to gain one more Planting Phase action. Two action buttons:
            // 'Use ability' enters baby-only multi-select; 'Skip' finishes
            // the Planting Phase normally.
            this.bga.statusBar.setTitle(_('Banana ability: discard 2 Baby Plants from your hand for one more Planting Phase action?'));
            this.bga.statusBar.addActionButton(
                _('Use Banana ability'),
                () => this.beginBananaCardSelection(),
                { color: 'blue' }
            );
            this.bga.statusBar.addActionButton(
                _('Skip'),
                () => this.bga.actions.performAction("actDeclineBananaAbility", {}),
                { color: 'gray' }
            );
        }
    }

    /**
     * Banana ability: enter a hand-multi-select mode restricted to Baby
     * Plant cards. The player must pick exactly 2 cards. As soon as 2 are
     * selected, surface a Confirm button that invokes actUseBananaAbility.
     */
    beginBananaCardSelection() {
        this.bga.statusBar.removeActionButtons();
        this.bga.statusBar.setTitle(_('Select 2 Baby Plant cards from your hand to discard.'));
        this.selectedPaymentCards = [];

        const hand = this.game.gamedatas.hand || {};
        const plantTypes = this.game.gamedatas.plantCardTypes || {};
        const babyIds = Object.values(hand)
            .filter(c => plantTypes[c.type] && plantTypes[c.type].plant_type
                ? plantTypes[c.type].plant_type.startsWith('baby_')
                : false)
            .map(c => c.id);

        // Highlight the eligible Baby cards in the player's hand.
        babyIds.forEach(id => {
            const el = document.getElementById(`card_${id}`);
            if (el) {
                el.classList.add('bga-cards_selectable-card');
                el.style.boxShadow = '0 0 10px #f1c40f';
                el.style.cursor = 'pointer';
                el.onclick = () => this.toggleBananaBabySelection(id, babyIds);
            }
        });
    }

    toggleBananaBabySelection(cardId, eligibleIds) {
        if (this.selectedPaymentCards.includes(cardId)) {
            this.selectedPaymentCards = this.selectedPaymentCards.filter(c => c !== cardId);
            const el = document.getElementById(`card_${cardId}`);
            if (el) el.style.boxShadow = '0 0 10px #f1c40f';
        } else {
            if (this.selectedPaymentCards.length >= 2) return; // hard cap
            this.selectedPaymentCards.push(cardId);
            const el = document.getElementById(`card_${cardId}`);
            if (el) el.style.boxShadow = '0 0 15px #27ae60';
        }

        this.bga.statusBar.removeActionButtons();
        if (this.selectedPaymentCards.length === 2) {
            this.bga.statusBar.addActionButton(_('Confirm Discard (2 Baby Plants)'), () => {
                this.bga.actions.performAction("actUseBananaAbility", {
                    babyCardIdsStr: this.selectedPaymentCards.join(';'),
                });
            }, { color: 'green' });
        }
        this.bga.statusBar.addActionButton(_('Cancel — skip Banana ability'), () => {
            this.bga.actions.performAction("actDeclineBananaAbility", {});
        }, { color: 'gray' });
    }

    renderDraftModal(keepQty) {
        this.cleanupUI();
        const pId = this.bga.players.getCurrentPlayerId();
        const draftCards = this.game.gamedatas.draftCards;
        if (!draftCards || Object.keys(draftCards).length === 0) return;

        this.selectedDraftCards = [];

        this.bga.gameArea.getElement().insertAdjacentHTML('afterbegin', `
            <div id="draft-container" style="padding: 20px; background: rgba(0,0,0,0.8); border-radius: 10px; margin-bottom: 20px; text-align: center; color: white;">
                <h2>Choose ${keepQty} Card(s) to Keep</h2>
                <div style="display: flex; justify-content: center; gap: 15px; margin-top: 15px;" id="draft-cards-list"></div>
                <div style="margin-top: 20px;" id="draft-actions"></div>
            </div>
        `);

        const list = document.getElementById('draft-cards-list');
        Object.values(draftCards).forEach(c => {
            const cardInfo = this.game.gamedatas.plantCardTypes[c.type];
            list.insertAdjacentHTML('beforeend', `
                <div id="draft_${c.id}" class="bga-cards_selectable-card plant-card" style="width: 120px; height: 180px; border: 2px solid #2ecc71; border-radius: 10px; padding: 10px; background: #e8f8f5; color: black; display: flex; flex-direction: column; justify-content: center; cursor: pointer; box-shadow: 0 0 10px #27ae60;">
                    <strong style="color: #27ae60; font-size: 1.1em;">${cardInfo.name}</strong>
                    <div style="margin-top: 10px; font-size: 0.8em; color: #7f8c8d;">Cost: ${cardInfo.cost}</div>
                </div>
            `);
            
            this.game.addPlantTooltip(`draft_${c.id}`, cardInfo);
            
            const el = document.getElementById(`draft_${c.id}`);
            el.onclick = () => {
                if (this.selectedDraftCards.includes(c.id)) {
                    this.selectedDraftCards = this.selectedDraftCards.filter(id => id !== c.id);
                    el.style.boxShadow = '0 0 10px #27ae60';
                    el.style.border = '2px solid #2ecc71';
                } else {
                    if (this.selectedDraftCards.length < keepQty) {
                        this.selectedDraftCards.push(c.id);
                        el.style.boxShadow = '0 0 15px #f1c40f';
                        el.style.border = '4px solid #f1c40f';
                    }
                }
                
                const actions = document.getElementById('draft-actions');
                actions.innerHTML = '';
                if (this.selectedDraftCards.length === keepQty || this.selectedDraftCards.length === Object.keys(draftCards).length) {
                    const btn = document.createElement('button');
                    btn.className = 'bga-button bga-button_blue';
                    btn.innerText = 'Confirm';
                    btn.onclick = () => {
                        this.bga.actions.performAction("actResolveDraft", { cardIdsStr: this.selectedDraftCards.join(';') });
                        document.getElementById('draft-container').remove();
                    };
                    actions.appendChild(btn);
                }
            };
        });
    }
}

class WeatherPhaseChoose {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
    }

    onEnteringState(args, isCurrentPlayerActive) {
        this.onPlayerActivationChange(args, isCurrentPlayerActive);
    }

    onPlayerActivationChange(args, isCurrentPlayerActive) {
        this.bga.statusBar.removeActionButtons();
        
        if (!isCurrentPlayerActive) {
            this.bga.statusBar.setTitle(_('Waiting for other players to choose a Weather card...'));
            return;
        }

        this.bga.statusBar.setTitle(_('${you} must choose a Weather card to play from your hand'));
        
        const weatherHand = this.game.gamedatas.weatherHand;
        if (!weatherHand || Object.keys(weatherHand).length === 0) {
             return;
        }
        
        Object.values(weatherHand).forEach(card => {
            if (card.type === 'bonus') return;

            let label = '🌬️ Wind';
            if (card.type_arg == 0) label = '☀️ Sun';
            if (card.type_arg == 1) label = '💧 Rain';

            this.bga.statusBar.addActionButton(_(label), () => this.onChooseWeather(card.id), { color: 'blue' });
        });
    }

    onLeavingState(args, isCurrentPlayerActive) {
        this.bga.statusBar.removeActionButtons();
    }

    onChooseWeather(cardId) {
        this.bga.actions.performAction("actChooseWeather", { cardId });
    }
}

class WeatherPhaseBonus {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
        this.selectingBonus = false;
    }

    onEnteringState(args, isCurrentPlayerActive) {
        this.selectingBonus = false;

        if (args && args.planting_statuses) {
            Object.entries(args.planting_statuses).forEach(([pId, status]) => {
                if (this.game.gamedatas.players[pId]) {
                    this.game.gamedatas.players[pId].planting_status = status;
                }
            });
        }

        this.onPlayerActivationChange(args, isCurrentPlayerActive);
    }

    onPlayerActivationChange(args, isCurrentPlayerActive) {
        this.bga.statusBar.removeActionButtons();
        this.cleanupUI();
        
        if (!isCurrentPlayerActive) {
            this.bga.statusBar.setTitle(_('Waiting for other players to finish playing Bonus Weather...'));
            return;
        }

        const pId = this.bga.players.getCurrentPlayerId();
        const status = this.game.gamedatas.players[pId].planting_status;
        if (status == 1) {
            this.bga.statusBar.setTitle(_('Waiting for other players to finish playing Bonus Weather...'));
            return;
        }

        // Find if they have any bonus weather cards
        const hand = this.game.gamedatas.weatherHand;
        let hasBonus = false;
        if (hand) {
            Object.values(hand).forEach(c => {
                if (c.type === 'bonus') hasBonus = true;
            });
        }

        if (this.selectingBonus) {
            this.selectedBonusCards = this.selectedBonusCards || [];
            this.bga.statusBar.setTitle(_('${you} must select Bonus Weather cards to play'));

            if (this.selectedBonusCards.length > 0) {
                this.bga.statusBar.addActionButton(_('Done'), () => {
                    this.game.gamedatas.players[pId].planting_status = 1; // UPDATE LOCAL CACHE
                    this.bga.actions.performAction("actPlayBonusWeather", { cardIds: this.selectedBonusCards.join(';') });
                    this.selectingBonus = false;
                    this.selectedBonusCards = [];
                    this.onPlayerActivationChange(null, false);
                }, { color: 'blue' });
            } else {
                this.bga.statusBar.addActionButton(_('Skip'), () => {
                    this.game.gamedatas.players[pId].planting_status = 1; // UPDATE LOCAL CACHE
                    this.bga.actions.performAction("actPassBonus");
                    this.selectingBonus = false;
                    this.selectedBonusCards = [];
                    this.onPlayerActivationChange(null, false);
                }, { color: 'red' });
            }

            // Highlight bonus weather cards
            if (hand) {
                Object.values(hand).forEach(c => {
                    if (c.type === 'bonus') {
                        const el = document.getElementById(`weather_${c.id}`);
                        if (el) {
                            el.classList.add('bga-cards_selectable-card');
                            
                            if (this.selectedBonusCards.includes(c.id)) {
                                el.style.boxShadow = '0 0 10px #2ecc71';
                                el.style.border = '2px solid #2ecc71';
                            } else {
                                el.style.boxShadow = '0 0 10px #f1c40f';
                                el.style.border = '';
                            }

                            el.onclick = () => {
                                if (this.selectedBonusCards.includes(c.id)) {
                                    this.selectedBonusCards = this.selectedBonusCards.filter(id => id !== c.id);
                                } else {
                                    this.selectedBonusCards.push(c.id);
                                }
                                this.onPlayerActivationChange(args, true);
                            };
                        }
                    }
                });
            }
        } else {
            if (hasBonus) {
                this.bga.statusBar.setTitle(_('${you} may play Bonus Weather cards or proceed to Grow Plants'));
                this.bga.statusBar.addActionButton(_('Play Bonus Weather'), () => {
                    this.selectingBonus = true;
                    this.selectedBonusCards = [];
                    this.onPlayerActivationChange(args, true);
                }, { color: 'blue' });
            } else {
                this.bga.statusBar.setTitle(_('${you} must proceed to Grow Plants'));
            }
            this.bga.statusBar.addActionButton(_('Proceed to Grow Plants'), () => {
                this.game.gamedatas.players[pId].planting_status = 1; // UPDATE LOCAL CACHE
                this.bga.actions.performAction("actPassBonus");
                this.onPlayerActivationChange(null, false); // Manually trigger waiting UI immediately
            }, { color: 'green' });
        }
    }

    onLeavingState(args, isCurrentPlayerActive) {
        this.bga.statusBar.removeActionButtons();
        this.cleanupUI();
    }

    cleanupUI() {
        document.querySelectorAll('.weather-card').forEach(el => {
            el.classList.remove('bga-cards_selectable-card');
            el.style.boxShadow = '2px 2px 5px rgba(0,0,0,0.1)';
            el.style.border = '';
            el.onclick = null;
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

        this.plantingPhase = new PlantingPhase(this, bga);
        this.bga.states.register('PlantingPhase', this.plantingPhase);

        this.weatherPhaseChoose = new WeatherPhaseChoose(this, bga);
        this.bga.states.register('WeatherPhaseChoose', this.weatherPhaseChoose);

        this.weatherPhaseBonus = new WeatherPhaseBonus(this, bga);
        this.bga.states.register('WeatherPhaseBonus', this.weatherPhaseBonus);

        // Uncomment the next line to show debug informations about state changes in the console. Remove before going to production!
        // this.bga.states.logger = console.log;
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

        // Always render the current player's garden first so it sits directly
        // below their hand panel (which is prepended to #player-tables below).
        // Spectators fall back to default player order.
        const currentPlayerId = this.bga.players.getCurrentPlayerId();
        const orderedPlayers = Object.values(gamedatas.players).sort((a, b) => {
            if (a.id == currentPlayerId) return -1;
            if (b.id == currentPlayerId) return 1;
            return 0;
        });

        // Setting up player boards
        orderedPlayers.forEach(player => {
            // example of setting up players boards
            this.bga.playerPanels.getElement(player.id).insertAdjacentHTML('beforeend', `
                <div style="margin-top: 5px;">
                    <span id="hand-count-${player.id}"></span> Hand Cards
                </div>
                <div>
                    <span id="energy-player-counter-${player.id}"></span> Energy
                </div>
            `);
            
            if (!this.handCounters) this.handCounters = {};
            const handCounter = new ebg.counter();
            handCounter.create(`hand-count-${player.id}`);
            handCounter.setValue(gamedatas.handCounts ? (gamedatas.handCounts[player.id] || 0) : 0);
            this.handCounters[player.id] = handCounter;

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

            // Render planters for this player
            const planters = Object.values(gamedatas.planters || {}).filter(c => c.location_arg == player.id);
            this.renderPlanters(planters, `player-garden-${player.id}`);
            
            // Render Level 3 plants for this player (rendered just directly in the garden container alongside planters)
            const level3Plants = Object.values(gamedatas.plantsLevel3 || {}).filter(c => c.location_arg == player.id);
            level3Plants.forEach(card => {
                const cardInfo = this.gamedatas.plantCardTypes[card.type];
                document.getElementById(`player-garden-${player.id}`).insertAdjacentHTML('beforeend', `
                    <div id="garden_plant_${card.id}" class="level3-tilted" data-id="${card.id}" style="width: 120px; height: 180px; border: 2px solid #2ecc71; border-radius: 5px; background: #e8f8f5; text-align: center; display: flex; flex-direction: column; justify-content: center; transform: rotate(90deg); margin: 0 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        <strong style="color: #27ae60; font-size: 0.9em;">${cardInfo.name}</strong>
                        <div class="plant-level-indicator" style="margin-top: 5px; font-size: 0.8em; color: #7f8c8d; font-weight: bold;">Level: ${card.type_arg}</div>
                    </div>
                `);
                this.addPlantTooltip(`garden_plant_${card.id}`, cardInfo);
            });
        });

        // Render plants on planters (done after all planters are created)
        Object.values(gamedatas.plantsOnPlanters || {}).forEach(card => {
            this.renderPlantInPlanter(card, card.location_arg);
        });

        // Render Bonus Weather for each player directly in their garden
        orderedPlayers.forEach(player => {
            const playerBonusWeather = Object.values(gamedatas.weatherPublicBonus || {}).filter(c => c.location_arg == player.id);
            playerBonusWeather.forEach(card => {
                let cardInfo = { name: 'Unknown' };
                if (this.gamedatas.weatherCardTypes[card.type] && this.gamedatas.weatherCardTypes[card.type].cards[card.type_arg]) {
                    cardInfo = this.gamedatas.weatherCardTypes[card.type].cards[card.type_arg];
                }
                const garden = document.getElementById(`player-garden-${player.id}`);
                if (garden) {
                    garden.insertAdjacentHTML('beforeend', `
                        <div id="weather_${card.id}" class="weather-card bonus-weather" style="width: 120px; height: 180px; border: 2px solid #9b59b6; border-radius: 10px; padding: 10px; text-align: center; background: #f5eef8; display: flex; flex-direction: column; justify-content: center; box-shadow: 2px 2px 5px rgba(0,0,0,0.1); transition: transform 0.2s;">
                            <strong style="color: #8e44ad; font-size: 1.1em;">${cardInfo.name} (Bonus)</strong>
                        </div>
                    `);
                    const newCard = document.getElementById(`weather_${card.id}`);
                    newCard.addEventListener('mouseenter', () => newCard.style.transform = 'translateY(-10px)');
                    newCard.addEventListener('mouseleave', () => newCard.style.transform = 'translateY(0)');
                }
            });
        });

        // Add a Bonus Weather section under the player gardens
        document.getElementById('player-tables').insertAdjacentHTML('afterend', `
            <div id="bonus-weather-section" style="border: 1px solid #ccc; margin: 10px; padding: 10px; background: rgba(255,255,255,0.8); border-radius: 8px;">
                <h3 style="margin-top: 0;">Bonus Weather</h3>
                <div id="bonus-weather-container" style="display: flex; gap: 10px; margin-top: 10px; min-height: 150px;"></div>
            </div>
        `);

        if (gamedatas.bonusWeatherMarket) {
            this.renderBonusWeatherMarket(gamedatas.bonusWeatherMarket, 'bonus-weather-container');
        }

        // Add a Public Weather section
        document.getElementById('bonus-weather-section').insertAdjacentHTML('beforebegin', `
            <div id="public-weather-section" style="border: 1px solid #ccc; margin: 10px; padding: 10px; background: rgba(255,255,255,0.8); border-radius: 8px;">
                <h3 style="margin-top: 0;">Public Weather Cards</h3>
                <div id="weather-public-container" style="display: flex; gap: 10px; margin-top: 10px; min-height: 150px;"></div>
            </div>
        `);

        if (gamedatas.weatherPublic) {
            this.renderPublicWeather(gamedatas.weatherPublic);
        }

        // Add a dedicated hand panel for the current player, placed above the
        // player gardens so it's visible without scrolling past every player's
        // garden first.
        document.getElementById('player-tables').insertAdjacentHTML('beforebegin', `
            <div id="hand_panel" style="margin-bottom: 20px; border: 2px solid #27ae60; border-radius: 8px; background: rgba(255, 255, 255, 0.9); padding: 15px;">
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

    renderPlanters(cards, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!cards) return;

        Object.values(cards).forEach(card => {
            container.insertAdjacentHTML('beforeend', `
                <div id="planter_${card.id}" class="planter-card" data-id="${card.id}" style="width: 120px; height: 180px; border: 2px dashed #95a5a6; border-radius: 10px; padding: 10px; text-align: center; background: rgba(255,255,255,0.5); display: flex; flex-direction: column; justify-content: flex-end; position: relative;">
                    <div style="font-size: 0.8em; color: #7f8c8d; font-weight: bold; margin-bottom: 5px;">PLANTER</div>
                    <div style="display: flex; justify-content: space-around; margin-top: auto; color: #bdc3c7; font-weight: bold; font-family: monospace;">
                        <span>3</span><span>2</span><span>1</span><span style="color: #27ae60;">0</span>
                    </div>
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
                this.addPlantTooltip(`card_${card.id}`, cardInfo);
            });
        }

        if (weatherHandData) {
            Object.values(weatherHandData).forEach(card => {
                // Hide character weather cards as they are available in the status bar during Weather Phase
                if (card.type !== 'bonus') {
                    return;
                }

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

    renderBonusWeatherMarket(marketData, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        
        // Group by type_arg (Wind=2, Rain=1, Sun=0)
        // Order: Wind, Rain, Sun
        const groups = {
            2: [], // Wind
            1: [], // Rain
            0: [], // Sun
        };
        
        Object.values(marketData).forEach(card => {
            if (groups[card.type_arg]) {
                groups[card.type_arg].push(card);
            }
        });
        
        const order = [2, 1, 0];
        order.forEach(type_arg => {
            const cards = groups[type_arg];
            if (cards && cards.length > 0) {
                // Create a group container
                const groupDiv = document.createElement('div');
                groupDiv.id = `bonus-weather-group-${type_arg}`;
                groupDiv.style.display = 'flex';
                
                cards.forEach((card, index) => {
                    const cardInfo = this.gamedatas.weatherCardTypes[card.type].cards[card.type_arg];
                    const cardEl = document.createElement('div');
                    cardEl.id = `weather_${card.id}`;
                    cardEl.className = 'weather-card';
                    cardEl.style.width = '120px';
                    cardEl.style.height = '180px';
                    cardEl.style.border = '2px solid #3498db';
                    cardEl.style.borderRadius = '10px';
                    cardEl.style.padding = '10px';
                    cardEl.style.textAlign = 'center';
                    cardEl.style.background = '#ebf5fb';
                    cardEl.style.display = 'flex';
                    cardEl.style.flexDirection = 'column';
                    cardEl.style.justifyContent = 'center';
                    cardEl.style.boxShadow = '2px 2px 5px rgba(0,0,0,0.1)';
                    cardEl.style.cursor = 'pointer';
                    cardEl.style.transition = 'transform 0.2s';
                    
                    if (index > 0) {
                        cardEl.style.marginLeft = '-100px';
                    }
                    
                    cardEl.innerHTML = `<strong style="color: #2980b9; font-size: 1.1em;">${cardInfo.name}</strong>`;
                    groupDiv.appendChild(cardEl);
                });
                
                container.appendChild(groupDiv);
            }
        });
        
        // Add simple hover effect to bonus weather cards
        document.querySelectorAll('#bonus-weather-container .weather-card').forEach(card => {
            card.addEventListener('mouseenter', () => card.style.transform = 'translateY(-10px)');
            card.addEventListener('mouseleave', () => card.style.transform = 'translateY(0)');
        });
    }

    renderPublicWeather(weatherData) {
        const container = document.getElementById('weather-public-container');
        if (!container) return;
        container.innerHTML = '';
        
        Object.values(weatherData || {}).forEach(card => {
            let cardInfo = { name: 'Unknown' };
            if (this.gamedatas.weatherCardTypes[card.type] && this.gamedatas.weatherCardTypes[card.type].cards[card.type_arg]) {
                cardInfo = this.gamedatas.weatherCardTypes[card.type].cards[card.type_arg];
            }
            container.insertAdjacentHTML('beforeend', `
                <div id="weather_${card.id}" class="weather-card public-weather" style="width: 120px; height: 180px; border: 2px solid #e67e22; border-radius: 10px; padding: 10px; text-align: center; background: #fdf2e9; display: flex; flex-direction: column; justify-content: center; box-shadow: 2px 2px 5px rgba(0,0,0,0.1); transition: transform 0.2s;">
                    <strong style="color: #d35400; font-size: 1.1em;">${cardInfo.name}</strong>
                </div>
            `);
        });

        document.querySelectorAll('#weather-public-container .weather-card').forEach(card => {
            card.addEventListener('mouseenter', () => card.style.transform = 'translateY(-10px)');
            card.addEventListener('mouseleave', () => card.style.transform = 'translateY(0)');
        });
    }

    ///////////////////////////////////////////////////
    //// Reaction to cometD notifications

    /*
        setupNotifications:
        
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
    
    async notif_updateScores(args) {
        console.log("notif_updateScores", args);
        const scores = args.scores;
        const handCounts = args.handCounts;
        
        for (const playerId in scores) {
            this.gamedatas.players[playerId].score = scores[playerId];
            if (this.bga.playerPanels.getScoreCounter(playerId)) {
                this.bga.playerPanels.getScoreCounter(playerId).toValue(scores[playerId]);
            }
        }
        
        for (const playerId in handCounts) {
            if (this.handCounters && this.handCounters[playerId]) {
                this.handCounters[playerId].toValue(handCounts[playerId]);
            }
        }
    }
    
    async notif_newHand(args) {
        console.log("notif_newHand", args);
        // The server sends the new hand when the player redraws
        this.gamedatas.hand = args.cards;
        this.renderHand(this.gamedatas.hand, this.gamedatas.weatherHand);
    }

    async notif_potatoExtraCards(args) {
        console.log("notif_potatoExtraCards", args);
        // Update every player's hand counter from the server-provided counts.
        const handCounts = args.handCounts || {};
        for (const playerId in handCounts) {
            if (this.handCounters && this.handCounters[playerId]) {
                this.handCounters[playerId].toValue(handCounts[playerId]);
            }
        }
    }

    async notif_mushroomBonusWeather(args) {
        console.log("notif_mushroomBonusWeather", args);
        const cards = args.cards || [];
        if (!this.gamedatas.weatherPublicBonus) this.gamedatas.weatherPublicBonus = {};
        const garden = document.getElementById(`player-garden-${args.player_id}`);
        cards.forEach(card => {
            // Track in local gamedatas so subsequent renders include the card.
            this.gamedatas.weatherPublicBonus[card.id] = card;
            if (!garden) return;
            let cardInfo = { name: 'Unknown' };
            if (this.gamedatas.weatherCardTypes[card.type]
                && this.gamedatas.weatherCardTypes[card.type].cards[card.type_arg]) {
                cardInfo = this.gamedatas.weatherCardTypes[card.type].cards[card.type_arg];
            }
            garden.insertAdjacentHTML('beforeend', `
                <div id="weather_${card.id}" class="weather-card bonus-weather" style="width: 120px; height: 180px; border: 2px solid #9b59b6; border-radius: 10px; padding: 10px; text-align: center; background: #f5eef8; display: flex; flex-direction: column; justify-content: center; box-shadow: 2px 2px 5px rgba(0,0,0,0.1); transition: transform 0.2s;">
                    <strong style="color: #8e44ad; font-size: 1.1em;">${cardInfo.name} (Bonus)</strong>
                </div>
            `);
            const newCard = document.getElementById(`weather_${card.id}`);
            if (newCard) {
                newCard.addEventListener('mouseenter', () => newCard.style.transform = 'translateY(-10px)');
                newCard.addEventListener('mouseleave', () => newCard.style.transform = 'translateY(0)');
            }
        });
    }

    async notif_playerPlayedBonus(args) {
        console.log("notif_playerPlayedBonus", args);
        const card = args.card;
        
        // Remove from hand if it's our hand
        if (args.player_id == this.bga.players.getCurrentPlayerId()) {
            if (this.gamedatas.weatherHand && this.gamedatas.weatherHand[card.id]) {
                delete this.gamedatas.weatherHand[card.id];
                this.renderHand(this.gamedatas.hand, this.gamedatas.weatherHand);
            }
        }
        
        // Update data state
        if (!this.gamedatas.weatherPublicBonus) this.gamedatas.weatherPublicBonus = {};
        this.gamedatas.weatherPublicBonus[card.id] = card;

        // Add to player's garden visually
        const garden = document.getElementById(`player-garden-${args.player_id}`);
        if (garden) {
            let cardInfo = this.gamedatas.weatherCardTypes[card.type].cards[card.type_arg];
            garden.insertAdjacentHTML('beforeend', `
                <div id="weather_${card.id}" class="weather-card bonus-weather" style="width: 120px; height: 180px; border: 2px solid #9b59b6; border-radius: 10px; padding: 10px; text-align: center; background: #f5eef8; display: flex; flex-direction: column; justify-content: center; box-shadow: 2px 2px 5px rgba(0,0,0,0.1); transition: transform 0.2s;">
                    <strong style="color: #8e44ad; font-size: 1.1em;">${cardInfo.name} (Bonus)</strong>
                </div>
            `);
            const newCard = document.getElementById(`weather_${card.id}`);
            if (newCard) {
                newCard.addEventListener('mouseenter', () => newCard.style.transform = 'translateY(-10px)');
                newCard.addEventListener('mouseleave', () => newCard.style.transform = 'translateY(0)');
            }
        }

        if (args.player_id == this.bga.players.getCurrentPlayerId() && this.bga.states.getCurrentMainStateName() === 'WeatherPhaseBonus') {
             this.weatherPhaseBonus.onPlayerActivationChange(null, true);
        }
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

    async notif_playerReceivedWeather(args) {
        if (args.bonusMarket) {
            this.gamedatas.bonusWeatherMarket = args.bonusMarket;
            this.renderBonusWeatherMarket(this.gamedatas.bonusWeatherMarket, 'bonus-weather-container');
        }
    }
    
    async notif_weatherDeckFlipped(args) {
        if (!this.gamedatas.weatherPublic) this.gamedatas.weatherPublic = {};
        Object.values(args.cards).forEach(c => {
            this.gamedatas.weatherPublic[c.id] = c;
        });
        this.renderPublicWeather(this.gamedatas.weatherPublic);
    }

    async notif_weatherCleared(args) {
        this.gamedatas.weatherPublic = {};
        this.gamedatas.weatherPublicBonus = {};
        this.renderPublicWeather(this.gamedatas.weatherPublic);
        
        // Remove bonus weather cards from gardens
        document.querySelectorAll('.weather-card.bonus-weather').forEach(el => el.remove());

        if (args.bonusMarket) {
            this.gamedatas.bonusWeatherMarket = args.bonusMarket;
            this.renderBonusWeatherMarket(args.bonusMarket, 'bonus-weather-container');
        }
    }

    async notif_weatherChosen(args) {
        const cardId = args.card_id;
        if (this.gamedatas.weatherHand && this.gamedatas.weatherHand[cardId]) {
            delete this.gamedatas.weatherHand[cardId];
            this.renderHand(this.gamedatas.hand, this.gamedatas.weatherHand);
        }
        if (this.bga.states.getCurrentMainStateName() === 'WeatherPhaseChoose') {
            this.weatherPhaseChoose.onEnteringState(null, false);
        }
    }

    async notif_weatherRevealed(args) {
        this.gamedatas.weatherPublic = args.cards;
        this.renderPublicWeather(this.gamedatas.weatherPublic);
    }

    async notif_cardsDrawn(args) {
        if (!this.gamedatas.hand) {
            this.gamedatas.hand = {};
        }
        Object.values(args.cards).forEach(c => {
            this.gamedatas.hand[c.id] = c;
        });
        this.renderHand(this.gamedatas.hand, this.gamedatas.weatherHand);
    }

    async notif_playerDrewCard(args) {
        // Simple notification, UI might not need to update much other than opponent hand count
    }

    async notif_playerGainedAction(args) {
        if (args.player_id == this.bga.players.getCurrentPlayerId()) {
            this.game.gamedatas.players[args.player_id].planting_status = 0;
            this.resetSelection();
            this.onPlayerActivationChange(null, true);
        }
    }

    async notif_plantPlanted(args) {
        const card = args.card;
        const planterId = args.planter_id;

        if (this.gamedatas.hand) {
            let handChanged = false;
            if (this.gamedatas.hand[card.id]) {
                delete this.gamedatas.hand[card.id];
                handChanged = true;
            }
            (args.payment_card_ids || []).forEach(pid => {
                if (this.gamedatas.hand[pid]) {
                    delete this.gamedatas.hand[pid];
                    handChanged = true;
                }
            });
            if (handChanged) {
                this.renderHand(this.gamedatas.hand, this.gamedatas.weatherHand);
            }
        }

        // Add to plantsOnPlanters
        if (!this.gamedatas.plantsOnPlanters) this.gamedatas.plantsOnPlanters = {};
        this.gamedatas.plantsOnPlanters[card.id] = card;

        // Render the plant in the planter
        this.renderPlantInPlanter(card, planterId);

        if (args.player_id == this.bga.players.getCurrentPlayerId()) {
            this.gamedatas.players[args.player_id].planting_status = 1;
            if (this.bga.states.getCurrentMainStateName() === 'PlantingPhase') {
                this.plantingPhase.onEnteringState(null, true);
            }
        }
    }

    async notif_plantGrown(args) {
        const cardId = args.card_id;
        const level = args.level;
        
        // Update data
        if (this.gamedatas.plantsOnPlanters && this.gamedatas.plantsOnPlanters[cardId]) {
            this.gamedatas.plantsOnPlanters[cardId].type_arg = level;
            
            // Move up visually
            const el = document.getElementById(`garden_plant_${cardId}`);
            if (el) {
                el.querySelector('.plant-level-indicator').innerText = `Level: ${level}`;
            }

            if (args.max_level) {
                // Move off planter to garden
                const card = this.gamedatas.plantsOnPlanters[cardId];
                delete this.gamedatas.plantsOnPlanters[cardId];
                if (!this.gamedatas.plantsLevel3) this.gamedatas.plantsLevel3 = {};
                this.gamedatas.plantsLevel3[cardId] = card;

                if (el) {
                    el.classList.add('level3-tilted');
                    el.style.transform = 'rotate(90deg)';
                    const planterContainer = el.parentElement;
                    const gardenContainer = planterContainer.parentElement;
                    gardenContainer.appendChild(el); // Move out of planter
                }
            }
        }

        if (args.player_id == this.bga.players.getCurrentPlayerId()) {
            this.gamedatas.players[args.player_id].planting_status = 1;
            if (this.bga.states.getCurrentMainStateName() === 'PlantingPhase') {
                this.plantingPhase.onEnteringState(null, true);
            }
        }
    }

    async notif_draftCards(args) {
        this.gamedatas.draftCards = args.cards;
    }

    async notif_playerStartedDrafting(args) {
        // Just a text log notification now
    }

    async notif_pendingEffects(args) {
        if (args.effects && args.effects.length > 0) {
            const pId = this.bga.players.getCurrentPlayerId();
            if (this.gamedatas.players[pId]) {
                this.gamedatas.players[pId].pending_effects = JSON.stringify(args.effects);
                this.gamedatas.players[pId].planting_status = 3;
                if (this.bga.states.getCurrentMainStateName() === 'PlantingPhase') {
                    this.plantingPhase.onEnteringState(null, true);
                }
            }
        }
    }

    async notif_keptCards(args) {
        if (!this.gamedatas.hand) this.gamedatas.hand = {};
        (args.cards || []).forEach(card => {
            this.gamedatas.hand[card.id] = card;
        });
        this.gamedatas.draftCards = {};
        this.renderHand(this.gamedatas.hand, this.gamedatas.weatherHand);
    }

    async notif_playerKeptDraft(args) {
        if (args.player_id == this.bga.players.getCurrentPlayerId()) {
            this.gamedatas.players[args.player_id].planting_status = 1;
            if (this.bga.states.getCurrentMainStateName() === 'PlantingPhase') {
                this.plantingPhase.onEnteringState(null, true);
            }
        }
    }

    renderPlantInPlanter(card, planterId) {
        const planterEl = document.getElementById(`planter_${planterId}`);
        if (!planterEl) return;

        const cardInfo = this.gamedatas.plantCardTypes[card.type];
        
        planterEl.insertAdjacentHTML('beforeend', `
            <div id="garden_plant_${card.id}" data-id="${card.id}" style="position: absolute; bottom: 30px; left: 10px; right: 10px; height: 120px; border: 2px solid #2ecc71; border-radius: 5px; background: #e8f8f5; text-align: center; display: flex; flex-direction: column; justify-content: center; z-index: 10; box-shadow: 0 4px 6px rgba(0,0,0,0.1); transition: all 0.3s;">
                <strong style="color: #27ae60; font-size: 0.9em;">${cardInfo.name}</strong>
                <div class="plant-level-indicator" style="margin-top: 5px; font-size: 0.8em; color: #7f8c8d; font-weight: bold;">Level: ${card.type_arg}</div>
            </div>
        `);
        this.addPlantTooltip(`garden_plant_${card.id}`, cardInfo);
    }

    getFamily(plantType) {
        if (['baby_cactus', 'trv_cactus'].includes(plantType)) return 'cactus';
        if (['baby_flower', 'trv_flower'].includes(plantType)) return 'flower';
        if (['baby_tree', 'trv_tree'].includes(plantType)) return 'tree';
        return '';
    }

    getPlantCard(cardId) {
        if (this.gamedatas.plantsOnPlanters && this.gamedatas.plantsOnPlanters[cardId]) {
            return this.gamedatas.plantsOnPlanters[cardId];
        }
        if (this.gamedatas.plantsLevel3 && this.gamedatas.plantsLevel3[cardId]) {
            return this.gamedatas.plantsLevel3[cardId];
        }
        return null;
    }

    getFormattedPlantType(plantType) {
        if (!plantType) return '';
        const words = plantType.split('_');
        return words.map(w => w === 'trv' ? 'Treevolved' : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    addPlantTooltip(nodeId, cardInfo) {
        if (!cardInfo || !cardInfo.name) return;
        
        let formattedCost = cardInfo.cost;
        if (cardInfo.plant_type.startsWith('baby_')) {
            formattedCost = cardInfo.cost == 1 ? cardInfo.cost + ' ' + _('card') : cardInfo.cost + ' ' + _('cards');
        } else if (cardInfo.plant_type.startsWith('trv_')) {
            if (cardInfo.plant_type.includes('cactus')) {
                formattedCost = _('Level') + ' ' + cardInfo.cost + ' ' + _('Baby Cactus');
            } else if (cardInfo.plant_type.includes('flower')) {
                formattedCost = _('Level') + ' ' + cardInfo.cost + ' ' + _('Baby Flower');
            } else if (cardInfo.plant_type.includes('tree')) {
                formattedCost = _('Level') + ' ' + cardInfo.cost + ' ' + _('Baby Tree');
            }
        }

        let html = `<div class="plant-tooltip" style="padding: 5px; max-width: 250px;">`;
        html += `<h3 style="margin: 0; color: #27ae60;">${cardInfo.name}</h3><hr style="margin: 5px 0;">`;
        html += `<div class="cardtooltip">`;
        html += `<div><strong>${_("Plant Type")}:</strong> ${this.getFormattedPlantType(cardInfo.plant_type)}</div>`;
        html += `<div><strong>${_("Growth Cost")}:</strong> ${formattedCost}</div>`;
        html += `<div><strong>${_("Points Per Level")}:</strong> ${cardInfo.points_per_level}</div>`;
        if (cardInfo.card_effect) {
            html += `<br><p class="smalltext" style="margin: 0;"><strong>${_("Card Effect")}:</strong><br><em>${cardInfo.card_effect}</em></p>`;
        }
        html += `</div></div>`;
        
        this.bga.gameui.addTooltipHtml(nodeId, html);
    }
}
