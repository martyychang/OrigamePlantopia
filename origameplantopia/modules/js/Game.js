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
            const myGarden = document.getElementById(`player-garden-planters-${this.bga.players.getCurrentPlayerId()}`);
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

        // onLeavingState fires once, for the whole table, when the game
        // moves past SetupDecisions (a MULTIPLE_ACTIVE_PLAYER state) — i.e.
        // only once every player has made both decisions. That's the right
        // moment to hide the Characters panel for good; leaving it up
        // between players (mid-state, via onPlayerActivationChange /
        // isCurrentPlayerActive branching) is intentional so a player who
        // finished early can still see others picking. See
        // https://trello.com/c/ggzwRe3E.
        document.getElementById('characters-panel').style.display = 'none';
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
        // Purely local to this state-class instance — see the identical
        // field on WeatherPhaseBonus and "Client-Side: isCurrentPlayerActive
        // Is the Only Truth" in AGENTS.md (https://trello.com/c/DCpOIanp).
        // This class used to layer a redundant `planting_status == 1`
        // ("Done") check on top of isCurrentPlayerActive, written by several
        // notif_* handlers below (notif_plantPlanted, notif_plantGrown,
        // notif_playerKeptDraft) into the SHARED gamedatas.players[pId]
        // object — the exact shape of bug that caused DCpOIanp elsewhere.
        // It never actually broke here (this class owns planting_status;
        // there was no cross-state collision), but the same latent race
        // applies: if a live onEnteringState ever ran with stale/partial
        // args, the redundant check could win over isCurrentPlayerActive
        // and wrongly lock the player into "waiting" until a reload. See
        // https://trello.com/c/e55vsa8Q.
        this.justActed = false;
    }

    onEnteringState(args, isCurrentPlayerActive) {
        this.justActed = false;
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

        // isCurrentPlayerActive is BGA's own authoritative tracking of the
        // multiactive-player set — always trust it over any custom client
        // cache. justActed only ever pushes further TOWARD waiting
        // (immediately after my own action, before the framework's
        // tracking has caught up) — never the reverse. See
        // https://trello.com/c/e55vsa8Q.
        if (!isCurrentPlayerActive || this.justActed) {
            this.bga.statusBar.setTitle(_('Waiting for other players to finish Planting...'));
            return;
        }

        const player = this.game.gamedatas.players[this.bga.players.getCurrentPlayerId()];
        // PlantingPlayerSubstate (PHP) only defines Ready=0 / Done=1 /
        // ResolvingEffects=3 — there has never been a 2 (see the doc
        // comment on that enum). Done=1 is now handled entirely via
        // isCurrentPlayerActive/justActed above, not by reading this value.
        const status = player.planting_status;

        if (status == 3) {
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
            } else {
                const cardInfo = this.game.gamedatas.plantCardTypes[this.game.gamedatas.hand[this.selectedCardToPlant].type];
                const cost = cardInfo.cost;

                if (this.isBaby(cardInfo.plant_type)) {
                    // Auto-pick an empty planter for Baby plants. No interactive
                    // planter step — the planter is just a container slot, and
                    // forcing a click on it was annoying when only one was free
                    // (see https://trello.com/c/PJf350MF).
                    if (!this.selectedPlanter) {
                        this.selectedPlanter = this.findOpenPlanter();
                        if (!this.selectedPlanter) {
                            this.bga.statusBar.setTitle(_('No empty planter available — cancel and choose a different action'));
                            return;
                        }
                    }
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
                        // Auto-pick the planter for the new Treevolved plant.
                        // Prefer the planter being vacated by the sacrifice
                        // (most natural — "this plant evolves in place"), and
                        // fall back to any other empty planter if the sacrifice
                        // was from garden_level3.
                        if (!this.selectedPlanter) {
                            const sacrificedId = this.selectedPaymentCards[0];
                            const sacrificed = (this.game.gamedatas.plantsOnPlanters || {})[sacrificedId];
                            const preferPlanterId = sacrificed ? sacrificed.location_arg : null;
                            this.selectedPlanter = this.findOpenPlanter(preferPlanterId);
                            if (!this.selectedPlanter) {
                                this.bga.statusBar.setTitle(_('No empty planter available — cancel and choose a different action'));
                                return;
                            }
                        }
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

    /**
     * Return the id of an empty planter belonging to the current player,
     * or null if none are available. If preferPlanterId is one of the
     * player's planters, it's treated as empty (used for Treevolved
     * sacrifice — the planter the sacrificed plant is on becomes free).
     */
    findOpenPlanter(preferPlanterId = null) {
        const pId = this.bga.players.getCurrentPlayerId();
        const planters = Object.values(this.game.gamedatas.planters).filter(p => p.location_arg == pId);
        const isOccupied = id => Object.values(this.game.gamedatas.plantsOnPlanters || {})
            .some(pl => pl.location_arg == id);

        if (preferPlanterId != null) {
            const preferred = planters.find(p => p.id == preferPlanterId);
            if (preferred) return preferred.id;
        }
        const empty = planters.find(p => !isOccupied(p.id));
        return empty ? empty.id : null;
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

    /**
     * Surface a "Skip" button on the current pending-effect prompt so the
     * player can bail out of a planting effect they don't want to resolve.
     * The server-side actSkipPendingEffect validates the effect type is
     * one of the skippable ones (level_up / level_up_family /
     * level_up_matching_adult / gain_weather). See
     * https://trello.com/c/qcAmX7KC.
     */
    addSkipEffectButton() {
        this.bga.statusBar.addActionButton(
            _('Skip'),
            () => this.bga.actions.performAction("actSkipPendingEffect", {}),
            { color: 'gray' }
        );
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
            this.addSkipEffectButton();
        } else if (effect.type === 'level_up') {
            this.bga.statusBar.setTitle(_('Choose a plant in your garden to grow'));
            this.highlightPlantsToGrow(id => {
                this.bga.actions.performAction("actResolveLevelUp", { plantCardId: id });
            });
            this.addSkipEffectButton();
        } else if (effect.type === 'level_up_family') {
            this.bga.statusBar.setTitle(_('Choose a plant family to grow'));
            this.bga.statusBar.addActionButton(_('Tree'), () => this.bga.actions.performAction("actResolveLevelUpFamily", { family: 'tree' }), { color: 'green' });
            this.bga.statusBar.addActionButton(_('Flower'), () => this.bga.actions.performAction("actResolveLevelUpFamily", { family: 'flower' }), { color: 'red' });
            this.bga.statusBar.addActionButton(_('Cactus'), () => this.bga.actions.performAction("actResolveLevelUpFamily", { family: 'cactus' }), { color: 'blue' });
            this.addSkipEffectButton();
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
            this.addSkipEffectButton();
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
            </div>
        `);

        const list = document.getElementById('draft-cards-list');

        // Per https://trello.com/c/YJXNQMHM: Confirm belongs in the status
        // bar like every other action in this game, not as a raw HTML
        // <button> stretched across the draft modal. Shown only once the
        // right number of cards is selected — the same "add the button
        // only when ready" pattern already used by Confirm Discard/
        // Done/Skip elsewhere in this file (see renderPendingEffect's
        // discard_cards branch and WeatherPhaseBonus), which gives the
        // same "can't confirm prematurely" behavior as a disabled button
        // without this framework needing to expose a disabled-button API.
        const updateConfirmButton = () => {
            this.bga.statusBar.removeActionButtons();
            if (this.selectedDraftCards.length === keepQty || this.selectedDraftCards.length === Object.keys(draftCards).length) {
                this.bga.statusBar.addActionButton(_('Confirm'), () => {
                    this.bga.actions.performAction("actResolveDraft", { cardIdsStr: this.selectedDraftCards.join(';') });
                    document.getElementById('draft-container').remove();
                }, { color: 'blue' });
            }
        };

        Object.values(draftCards).forEach(c => {
            const cardInfo = this.game.gamedatas.plantCardTypes[c.type];
            const body = this.game.plantCardBody(c.type, cardInfo, { showCost: true });
            list.insertAdjacentHTML('beforeend', `
                <div id="draft_${c.id}" class="bga-cards_selectable-card plant-card plantopia-card-size ${body.extraClass}" ${body.dataAttr} style="position: relative; border: 2px solid #2ecc71; border-radius: 10px; padding: 10px; background-color: #e8f8f5; color: black; display: flex; flex-direction: column; justify-content: center; cursor: pointer; box-shadow: 0 0 10px #27ae60;">
                    ${body.inner}
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
                updateConfirmButton();
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
        // Purely local to this state-class instance — deliberately NOT
        // stored on the shared gamedatas.players[pId] object. This used to
        // reuse gamedatas.players[pId].planting_status (PlantingPhase's own
        // field, whose value of 1 coincidentally ALSO means "done"), so a
        // value left over from this round's PlantingPhase — which just
        // finished for both players right before this state began — could
        // immediately misrender both players as "waiting" the instant
        // WeatherPhaseBonus started, before either had acted. See
        // https://trello.com/c/DCpOIanp. Reset every entry; exists purely
        // to give immediate local feedback right after MY OWN action,
        // before BGA's own multiactive-player tracking
        // (isCurrentPlayerActive) catches up over the network round-trip.
        this.justActed = false;
    }

    onEnteringState(args, isCurrentPlayerActive) {
        this.selectingBonus = false;
        this.justActed = false;

        // Resync from getArgs() rather than trusting whatever the
        // weatherCleared notification (fired one state earlier, by
        // WeatherPhaseGrow) already applied to gamedatas.weatherPublicBonus.
        // BGA queues/paces notifications separately from state-transition
        // rendering, so this state's UI could render before that
        // notification's queued processing actually lands — the player's
        // held cards would then look empty until a reload forced a full
        // resync. args is evaluated synchronously as part of entering this
        // exact state, so it's always current. See
        // https://trello.com/c/61uLM9hR.
        if (args && args.weatherPublicBonus !== undefined) {
            this.game.gamedatas.weatherPublicBonus = args.weatherPublicBonus;
        }

        this.onPlayerActivationChange(args, isCurrentPlayerActive);
    }

    onPlayerActivationChange(args, isCurrentPlayerActive) {
        this.bga.statusBar.removeActionButtons();
        this.cleanupUI();

        // isCurrentPlayerActive is BGA's own authoritative tracking of the
        // multiactive-player set for this state — always trust it over any
        // custom client cache. justActed only ever pushes further TOWARD
        // waiting (immediately after my own action, before the framework's
        // tracking has caught up) — never the reverse. See
        // https://trello.com/c/DCpOIanp.
        if (!isCurrentPlayerActive || this.justActed) {
            this.bga.statusBar.setTitle(_('Waiting for other players to finish playing Bonus Weather...'));
            return;
        }

        const pId = this.bga.players.getCurrentPlayerId();

        // Bonus weather cards are now held in weather_public_bonus (publicly
        // visible per player) instead of the player's private weather hand.
        // See https://trello.com/c/B5g3UmED.
        const myHeld = Object.values(this.game.gamedatas.weatherPublicBonus || {})
            .filter(c => c.type === 'bonus' && c.location_arg == pId);
        const hasBonus = myHeld.length > 0;

        if (this.selectingBonus) {
            this.selectedBonusCards = this.selectedBonusCards || [];
            this.bga.statusBar.setTitle(_('${you} must select Bonus Weather cards to play'));

            // Per https://trello.com/c/Tyxs3bcd: present choices as status
            // actions, the same way WeatherPhaseChoose presents Sun/Rain/
            // Wind buttons for the character weather card to play — not by
            // clicking a card tile. Bonus weather cards haven't been
            // rendered as clickable board tiles since
            // https://trello.com/c/uiJWdVTg ("counted only, not displayed
            // as garden tiles"), so the old tile-click flow here was
            // silently dead code: myHeld.forEach found no DOM element for
            // any card, `if (el)` skipped every one, and there was no way
            // to actually select a card to play at all.
            //
            // One button per weather condition (☀️/💧/🌬️, same labels and
            // type_arg mapping as WeatherPhaseChoose), shown only while the
            // player still holds an unselected card of that type. Clicking
            // adds ONE held card of that condition to this turn's
            // selection — which card instance doesn't matter, they're
            // interchangeable by type.
            const CONDITION_LABELS = { 0: '☀️ Sun', 1: '💧 Rain', 2: '🌬️ Wind' };
            const remaining = myHeld.filter(c => !this.selectedBonusCards.includes(c.id));
            [0, 1, 2].forEach(condition => {
                const card = remaining.find(c => c.type_arg == condition);
                if (!card) return;
                this.bga.statusBar.addActionButton(_(CONDITION_LABELS[condition]), () => {
                    this.selectedBonusCards.push(card.id);
                    // If every held card is now selected, there's nothing
                    // left to choose — proceed exactly as if Done had been
                    // clicked instead of waiting for an explicit click.
                    if (this.selectedBonusCards.length === myHeld.length) {
                        this.submitSelectedBonusCards();
                    } else {
                        this.onPlayerActivationChange(args, true);
                    }
                }, { color: 'blue' });
            });

            if (this.selectedBonusCards.length > 0) {
                this.bga.statusBar.addActionButton(_('Done'), () => this.submitSelectedBonusCards(), { color: 'green' });
            } else {
                this.bga.statusBar.addActionButton(_('Skip'), () => {
                    this.justActed = true;
                    this.bga.actions.performAction("actPassBonus");
                    this.selectingBonus = false;
                    this.selectedBonusCards = [];
                    this.onPlayerActivationChange(null, false);
                }, { color: 'red' });
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
                this.justActed = true;
                this.bga.actions.performAction("actPassBonus");
                this.onPlayerActivationChange(null, false); // Manually trigger waiting UI immediately
            }, { color: 'green' });
        }
    }

    submitSelectedBonusCards() {
        this.justActed = true;
        this.bga.actions.performAction("actPlayBonusWeather", { cardIds: this.selectedBonusCards.join(';') });
        this.selectingBonus = false;
        this.selectedBonusCards = [];
        this.onPlayerActivationChange(null, false);
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
            // Player panel: hand count + per-family / per-maturity / per-level
            // counts + bonus weather counts. Built by renderPlayerPanel below
            // (called on setup and refreshed after every relevant notification).
            // See https://trello.com/c/B5g3UmED.
            this.bga.playerPanels.getElement(player.id).insertAdjacentHTML('beforeend', `
                <div id="plantopia-panel-${player.id}" class="plantopia-player-panel" style="margin-top: 6px;"></div>
            `);
            this.renderPlayerPanel(player.id);

            // Three dedicated, always-overflowing rows instead of one shared
            // flex row (Trello https://trello.com/c/gcQP1950 follow-up):
            // planters+character, then level-3 tilted plants underneath,
            // then bonus weather. See .plantopia-overflow-row in the CSS.
            document.getElementById('player-tables').insertAdjacentHTML('beforeend', `
                <div id="player-table-${player.id}" style="border: 1px solid #ccc; margin: 10px; padding: 10px; background: rgba(255,255,255,0.8); border-radius: 8px;">
                    <h3>${player.name}'s Garden</h3>
                    <div id="player-garden-planters-${player.id}" class="plantopia-overflow-row" style="margin-top: 10px; min-height: 300px;"></div>
                    <div id="player-garden-tilted-${player.id}" class="plantopia-overflow-row" style="margin-top: 10px;"></div>
                    <div id="player-garden-bonus-${player.id}" class="plantopia-overflow-row" style="margin-top: 10px;"></div>
                </div>
            `);

            // Render planters for this player
            const planters = Object.values(gamedatas.planters || {}).filter(c => c.location_arg == player.id);
            this.renderPlanters(planters, `player-garden-planters-${player.id}`);

            // Render claimed characters for this player AFTER planters, so
            // they consistently land to the right. Both renderCharacters and
            // notif_characterClaimed insert via append (insertAdjacentHTML
            // 'beforeend' / appendChild) into this same shared row, so
            // whichever runs second determines left/right placement. A page
            // load/reload used to render characters first (left of planters)
            // while claiming live during play appended after (right of
            // planters) — inconsistent depending on when the client last
            // rendered. See https://trello.com/c/nBsWlxlT.
            const claimed = Object.values(gamedatas.claimedCharacters || {}).filter(c => c.location_arg == player.id);
            this.renderCharacters(claimed, `player-garden-planters-${player.id}`);

            // Render Level 3 plants for this player on their OWN row.
            const level3Plants = Object.values(gamedatas.plantsLevel3 || {}).filter(c => c.location_arg == player.id);
            level3Plants.forEach(card => {
                const cardInfo = this.gamedatas.plantCardTypes[card.type];
                const body = this.plantCardBody(card.type, cardInfo, { levelLabel: `Level: ${card.type_arg}` });
                document.getElementById(`player-garden-tilted-${player.id}`).insertAdjacentHTML('beforeend', `
                    <div id="garden_plant_${card.id}" class="level3-tilted plantopia-card-size ${body.extraClass}" ${body.dataAttr} data-id="${card.id}" style="position: relative; border: 2px solid #2ecc71; border-radius: 5px; background-color: #e8f8f5; text-align: center; display: flex; flex-direction: column; justify-content: center; transform: rotate(90deg); margin: 0 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        ${body.inner}
                    </div>
                `);
                this.addPlantTooltip(`garden_plant_${card.id}`, cardInfo);
            });
        });

        // Render plants on planters (done after all planters are created)
        Object.values(gamedatas.plantsOnPlanters || {}).forEach(card => {
            this.renderPlantInPlanter(card, card.location_arg);
        });

        // Bonus Weather held by each player is counted (weatherPublicBonus
        // feeds the player panel's Sun/Rain/Wind tally via
        // computePlayerStats) but not displayed as garden tiles.
        // See https://trello.com/c/uiJWdVTg.

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
            // Sprite-backed character power card. Name + ability text move into
            // a tooltip per https://trello.com/c/lfl5AO0s.
            container.insertAdjacentHTML('beforeend', `
                <div id="character_${card.id}" class="character-card plantopia-character-power-card plantopia-card-size" data-character-type="${card.type}" data-id="${card.id}" style="position: relative; border: 2px solid #8e44ad; border-radius: 10px; background-color: #f4ecf7; box-shadow: 2px 2px 5px rgba(0,0,0,0.1); transition: transform 0.2s; cursor: help;"></div>
            `);
            this.addCharacterTooltip(`character_${card.id}`, cardInfo);
        });
    }

    /**
     * Add a tooltip to a character power card showing the character name
     * and the ability text in the standard BGA cardtooltip layout.
     * See https://trello.com/c/lfl5AO0s.
     */
    addCharacterTooltip(nodeId, cardInfo) {
        if (!cardInfo || !cardInfo.name) return;
        const html = `
            <h3 style="margin: 0; color: #8e44ad;">${cardInfo.name}</h3>
            <hr style="margin: 5px 0;">
            <div class="cardtooltip">
                <p>${cardInfo.ability || ''}</p>
            </div>
        `;
        this.bga.gameui.addTooltipHtml(nodeId, html);
    }

    renderPlanters(cards, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!cards) return;

        Object.values(cards).forEach(card => {
            // The planter background art is bottom-anchored inside a TALLER
            // slot wrapper (.plantopia-planter-slot) so the full-size plant
            // card rendered on top of it (see renderPlantInPlanter) always
            // has enough headroom to slide up without being clipped, even
            // at its highest reveal position (level 2). See
            // https://trello.com/c/gcQP1950.
            container.insertAdjacentHTML('beforeend', `
                <div id="planter-slot_${card.id}" class="plantopia-planter-slot">
                    <div id="planter_${card.id}" class="planter-card plantopia-planter-card plantopia-card-size" data-id="${card.id}" style="position: absolute; bottom: 0; left: 0; border-radius: 10px;"></div>
                </div>
            `);
        });
    }

    isAdult(plantType) {
        return ['trv_cactus', 'trv_flower', 'trv_tree'].includes(plantType);
    }

    /**
     * Recompute a player's at-a-glance stats from the current gamedatas.
     * Returns:
     *   {
     *     handCount,
     *     plants: { cactus: {baby: [n0,n1,n2,n3], adult: [...]},
     *               flower: {...}, tree: {...} },
     *     bonusWeather: { sun, rain, wind }
     *   }
     * Per https://trello.com/c/B5g3UmED.
     */
    computePlayerStats(playerId) {
        const stats = {
            handCount: (this.gamedatas.handCounts || {})[playerId] || 0,
            plants: {
                cactus: { baby: [0,0,0,0], adult: [0,0,0,0] },
                flower: { baby: [0,0,0,0], adult: [0,0,0,0] },
                tree:   { baby: [0,0,0,0], adult: [0,0,0,0] },
            },
            bonusWeather: { sun: 0, rain: 0, wind: 0 },
        };

        const FAMILY = { baby_cactus: 'cactus', trv_cactus: 'cactus',
                         baby_flower: 'flower', trv_flower: 'flower',
                         baby_tree:   'tree',   trv_tree:   'tree' };
        const bumpPlant = (card) => {
            const info = (this.gamedatas.plantCardTypes || {})[card.type];
            if (!info) return;
            const family = FAMILY[info.plant_type];
            if (!family) return;
            const maturity = this.isAdult(info.plant_type) ? 'adult'
                          : (this.isBabyType(info.plant_type) ? 'baby' : null);
            if (!maturity) return;
            const level = Math.max(0, Math.min(3, parseInt(card.type_arg, 10) || 0));
            stats.plants[family][maturity][level]++;
        };

        // Plants on planters — owner is the planter's location_arg.
        Object.values(this.gamedatas.plantsOnPlanters || {}).forEach(card => {
            const planter = (this.gamedatas.planters || {})[card.location_arg];
            if (planter && planter.location_arg == playerId) bumpPlant(card);
        });
        // Level-3 plants — owner is the card's own location_arg.
        Object.values(this.gamedatas.plantsLevel3 || {}).forEach(card => {
            if (card.location_arg == playerId) bumpPlant(card);
        });

        // Bonus weather is publicly held in weather_public_bonus for every
        // player (per https://trello.com/c/B5g3UmED — held counts are
        // visible to everyone, decrement on play). Played-this-round cards
        // live in weather_played_bonus and are NOT counted toward "held".
        const COND = { 0: 'sun', 1: 'rain', 2: 'wind' };
        Object.values(this.gamedatas.weatherPublicBonus || {}).forEach(card => {
            if (card.location_arg != playerId) return;
            const c = COND[card.type_arg];
            if (c) stats.bonusWeather[c]++;
        });
        return stats;
    }

    /** Text shown on hover for each player-panel icon (Trello https://trello.com/c/3jIZmRy9). */
    static PANEL_ICON_TOOLTIPS = {
        hand: 'Cards in hand',
        baby_cactus: 'Baby Cactus in garden, by level (0 / 1 / 2 / 3)',
        adult_cactus: 'Adult Cactus in garden, by level (0 / 1 / 2 / 3)',
        baby_flower: 'Baby Flower in garden, by level (0 / 1 / 2 / 3)',
        adult_flower: 'Adult Flower in garden, by level (0 / 1 / 2 / 3)',
        baby_tree: 'Baby Tree in garden, by level (0 / 1 / 2 / 3)',
        adult_tree: 'Adult Tree in garden, by level (0 / 1 / 2 / 3)',
        sun: 'Bonus Sun Weather cards held',
        rain: 'Bonus Rain Weather cards held',
        wind: 'Bonus Wind Weather cards held',
    };

    /** Render or refresh the at-a-glance stats panel for one player. */
    renderPlayerPanel(playerId) {
        const el = document.getElementById(`plantopia-panel-${playerId}`);
        if (!el) return;
        const s = this.computePlayerStats(playerId);
        // Icons instead of text labels (Trello https://trello.com/c/3jIZmRy9),
        // styled after RFTG's counters: icon, a space, then the count — no
        // colon, no label text. Native `title` attribute gives each icon a
        // simple hover tooltip explaining what it means.
        const icon = (name) => `<span class="plantopia-panel-icon" data-icon="${name}" title="${Game.PANEL_ICON_TOOLTIPS[name] || ''}"></span>`;
        const line = (name, arr) => `${icon(name)} ${arr.join(' / ')}`;
        // Baby/Adult of the same family share a line, and the bonus weather
        // counters sit alongside the hand count — both per Marty's Trello
        // feedback (https://trello.com/c/3jIZmRy9). "&nbsp;&nbsp;&nbsp;&nbsp;"
        // is just breathing room between the two counters on a shared line.
        const gap = '&nbsp;&nbsp;&nbsp;&nbsp;';
        el.innerHTML = `
            <div>${icon('hand')} ${s.handCount}${gap}${icon('sun')} ${s.bonusWeather.sun}${gap}${icon('rain')} ${s.bonusWeather.rain}${gap}${icon('wind')} ${s.bonusWeather.wind}</div>
            <div>${line('baby_cactus', s.plants.cactus.baby)}${gap}${line('adult_cactus', s.plants.cactus.adult)}</div>
            <div>${line('baby_flower', s.plants.flower.baby)}${gap}${line('adult_flower', s.plants.flower.adult)}</div>
            <div>${line('baby_tree', s.plants.tree.baby)}${gap}${line('adult_tree', s.plants.tree.adult)}</div>
        `;
    }

    /** Refresh every player's stats panel. Cheap — runs after any state-changing notif. */
    refreshAllPlayerPanels() {
        Object.values(this.gamedatas.players || {}).forEach(p => this.renderPlayerPanel(p.id));
    }

    /**
     * HTML for the visible inside of a plant card. Adult (Treevolved) and
     * Baby plants both render via a CSS sprite (plantopia-adult-card /
     * plantopia-baby-card) addressed by a data-card-type attribute. Any
     * other type falls back to a text rendering. cardKey is the canonical
     * card_type column value (e.g. "Geometree") — NOT the translated
     * cardInfo.name, since the CSS sprite is keyed by the untranslated
     * card identity. levelLabel is an optional in-card indicator
     * (e.g. "Level: 2") for the planter view. See
     * https://trello.com/c/XynmHHxj and https://trello.com/c/iKxuW468.
     */
    plantCardBody(cardKey, cardInfo, { showCost = false, levelLabel = null } = {}) {
        const spriteClass = this.isAdult(cardInfo.plant_type)
            ? 'plantopia-adult-card'
            : (this.isBabyType(cardInfo.plant_type) ? 'plantopia-baby-card' : null);
        if (spriteClass) {
            const badge = levelLabel
                ? `<div class="plant-level-indicator" style="position: absolute; bottom: 4px; right: 4px; background: rgba(255,255,255,0.88); color: #27ae60; font-weight: bold; padding: 2px 6px; border-radius: 4px; font-size: 0.8em;">${levelLabel}</div>`
                : '';
            return {
                extraClass: spriteClass,
                dataAttr: `data-card-type="${String(cardKey).replace(/"/g, '&quot;')}"`,
                inner: badge,
            };
        }
        const nameLine = `<strong style="color: #27ae60; font-size: 1.0em;">${cardInfo.name}</strong>`;
        const detail = levelLabel
            ? `<div class="plant-level-indicator" style="margin-top: 5px; font-size: 0.8em; color: #7f8c8d; font-weight: bold;">${levelLabel}</div>`
            : (showCost ? `<div style="margin-top: 10px; font-size: 0.8em; color: #7f8c8d;">${cardInfo.cost ? 'Cost: ' + cardInfo.cost : ''}</div>` : '');
        return {
            extraClass: '',
            dataAttr: '',
            inner: `${nameLine}${detail}`,
        };
    }

    /** Game-scope mirror of PlantingPhase.isBaby — the latter lives on the
     * inner state class. plantCardBody needs the check here, on Game. */
    isBabyType(plantType) {
        return ['baby_cactus', 'baby_flower', 'baby_tree'].includes(plantType);
    }

    /**
     * HTML for the visible inside of a weather card. Bonus weather cards
     * (card.type='bonus') and character weather cards (card.type =
     * banana/carrot/mushroom/potato/tomato) both render via CSS sprites
     * addressed by data-weather-condition (sun/rain/wind, derived from
     * card.type_arg). Character weather cards additionally carry
     * data-character-type. Any other weather card type falls back to a
     * text rendering. See https://trello.com/c/NFy9xgyq and
     * https://trello.com/c/lfl5AO0s.
     */
    weatherCardBody(card, cardInfo) {
        const condition = { 0: 'sun', 1: 'rain', 2: 'wind' }[card.type_arg];
        if (card.type === 'bonus' && condition) {
            return {
                extraClass: 'plantopia-bonus-weather-card',
                dataAttr: `data-weather-condition="${condition}"`,
                inner: '',
            };
        }
        if (this.isCharacter(card.type) && condition) {
            return {
                extraClass: 'plantopia-character-weather-card',
                dataAttr: `data-character-type="${card.type}" data-weather-condition="${condition}"`,
                inner: '',
            };
        }
        return {
            extraClass: '',
            dataAttr: '',
            inner: `<strong style="color: #2980b9; font-size: 1.1em;">${cardInfo.name}</strong>`,
        };
    }

    isCharacter(type) {
        return ['banana', 'carrot', 'mushroom', 'potato', 'tomato'].includes(type);
    }

    renderHand(handData, weatherHandData) {
        const handContainer = document.getElementById('my-hand-container');
        if (!handContainer) return;

        handContainer.innerHTML = ''; // Clear current hand
        
        if (handData) {
            Object.values(handData).forEach(card => {
                // Get the card name from the material data provided by getAllDatas
                const cardInfo = this.gamedatas.plantCardTypes[card.type] || { name: card.type };
                const body = this.plantCardBody(card.type, cardInfo, { showCost: true });
                handContainer.insertAdjacentHTML('beforeend', `
                    <div id="card_${card.id}" class="plant-card plantopia-card-size ${body.extraClass}" ${body.dataAttr} style="position: relative; border: 2px solid #2ecc71; border-radius: 10px; padding: 10px; text-align: center; background-color: #e8f8f5; display: flex; flex-direction: column; justify-content: center; box-shadow: 2px 2px 5px rgba(0,0,0,0.1); cursor: pointer; transition: transform 0.2s;">
                        ${body.inner}
                    </div>
                `);
                this.addPlantTooltip(`card_${card.id}`, cardInfo);
            });
        }

        if (weatherHandData) {
            Object.values(weatherHandData).forEach(card => {
                // Only Bonus Weather cards render in the hand area. Character
                // weather cards are already presented (and chosen) via the
                // status bar buttons during WeatherPhaseChoose — showing them
                // again here duplicates that UI without adding information.
                // See https://trello.com/c/uiJWdVTg (reverses the "show every
                // weather card" change from https://trello.com/c/lfl5AO0s).
                if (card.type !== 'bonus') return;

                let cardInfo = { name: card.type };
                if (this.gamedatas.weatherCardTypes[card.type] && this.gamedatas.weatherCardTypes[card.type].cards[card.type_arg]) {
                    cardInfo = this.gamedatas.weatherCardTypes[card.type].cards[card.type_arg];
                }

                const body = this.weatherCardBody(card, cardInfo);
                handContainer.insertAdjacentHTML('beforeend', `
                    <div id="weather_${card.id}" class="weather-card plantopia-card-size ${body.extraClass}" ${body.dataAttr} style="position: relative; border: 2px solid #3498db; border-radius: 10px; padding: 10px; text-align: center; background-color: #ebf5fb; display: flex; flex-direction: column; justify-content: center; box-shadow: 2px 2px 5px rgba(0,0,0,0.1); cursor: pointer; transition: transform 0.2s;">
                        ${body.inner}
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
                    const body = this.weatherCardBody(card, cardInfo);
                    const cardEl = document.createElement('div');
                    cardEl.id = `weather_${card.id}`;
                    cardEl.className = `weather-card plantopia-card-size ${body.extraClass}`.trim();
                    if (body.dataAttr) {
                        // body.dataAttr looks like 'data-weather-condition="sun"'
                        const m = body.dataAttr.match(/^([\w-]+)="([^"]*)"$/);
                        if (m) cardEl.setAttribute(m[1], m[2]);
                    }
                    cardEl.style.position = 'relative';
                    cardEl.style.border = '2px solid #3498db';
                    cardEl.style.borderRadius = '10px';
                    cardEl.style.padding = '10px';
                    cardEl.style.textAlign = 'center';
                    cardEl.style.backgroundColor = '#ebf5fb';
                    cardEl.style.display = 'flex';
                    cardEl.style.flexDirection = 'column';
                    cardEl.style.justifyContent = 'center';
                    cardEl.style.boxShadow = '2px 2px 5px rgba(0,0,0,0.1)';
                    cardEl.style.cursor = 'pointer';
                    cardEl.style.transition = 'transform 0.2s';

                    if (index > 0) {
                        cardEl.style.marginLeft = '-100px';
                    }

                    cardEl.innerHTML = body.inner;
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
            // Every weather card in the deck is either a character card
            // (banana/carrot/mushroom/potato/tomato) or a bonus card — there
            // is no plain sun/rain/wind type — so weatherCardBody always has
            // a sprite for whatever lands in weather_public. This used to
            // hardcode a text-only rendering instead of reusing
            // weatherCardBody like the hand/bonus-market renderers do, so
            // public character weather cards showed as a name in a box
            // rather than their art. See https://trello.com/c/rwdYylsO.
            const body = this.weatherCardBody(card, cardInfo);
            container.insertAdjacentHTML('beforeend', `
                <div id="weather_${card.id}" class="weather-card public-weather plantopia-card-size ${body.extraClass}" ${body.dataAttr} style="background-color: #fdf2e9; border: 2px solid #e67e22; border-radius: 10px; padding: 10px; text-align: center; display: flex; flex-direction: column; justify-content: center; box-shadow: 2px 2px 5px rgba(0,0,0,0.1); transition: transform 0.2s;">
                    ${body.inner}
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

        if (handCounts) {
            if (!this.gamedatas.handCounts) this.gamedatas.handCounts = {};
            Object.assign(this.gamedatas.handCounts, handCounts);
        }
        this.refreshAllPlayerPanels();
    }

    async notif_newHand(args) {
        console.log("notif_newHand", args);
        // The server sends the new hand when the player redraws
        this.gamedatas.hand = args.cards;
        const pId = this.bga.players.getCurrentPlayerId();
        if (!this.gamedatas.handCounts) this.gamedatas.handCounts = {};
        this.gamedatas.handCounts[pId] = Object.keys(args.cards || {}).length;
        this.renderHand(this.gamedatas.hand, this.gamedatas.weatherHand);
        this.refreshAllPlayerPanels();
    }

    async notif_potatoExtraCards(args) {
        console.log("notif_potatoExtraCards", args);
        const handCounts = args.handCounts || {};
        if (!this.gamedatas.handCounts) this.gamedatas.handCounts = {};
        Object.assign(this.gamedatas.handCounts, handCounts);
        this.refreshAllPlayerPanels();
    }

    async notif_mushroomBonusWeather(args) {
        console.log("notif_mushroomBonusWeather", args);
        // Per https://trello.com/c/uiJWdVTg: Bonus Weather cards are
        // COUNTED (tracked in gamedatas + the player panel's Sun/Rain/Wind
        // tally) but not displayed as individual tiles in the garden.
        const cards = args.cards || [];
        if (!this.gamedatas.weatherPublicBonus) this.gamedatas.weatherPublicBonus = {};
        cards.forEach(card => {
            this.gamedatas.weatherPublicBonus[card.id] = card;
        });
        if (args.bonusMarket) {
            this.gamedatas.bonusWeatherMarket = args.bonusMarket;
            this.renderBonusWeatherMarket(args.bonusMarket, 'bonus-weather-container');
        }
        this.refreshAllPlayerPanels();
    }

    async notif_playerPlayedBonus(args) {
        console.log("notif_playerPlayedBonus", args);
        const card = args.card;

        // Per https://trello.com/c/B5g3UmED: playing a Bonus Weather card
        // moves it out of the player's public held stash and into the
        // round's played pool — the held count goes DOWN by 1. Bonus
        // Weather is counted, not displayed as tiles (see
        // https://trello.com/c/uiJWdVTg), so there's no DOM tile to
        // restyle here anymore; just update the data.
        if (this.gamedatas.weatherPublicBonus) {
            delete this.gamedatas.weatherPublicBonus[card.id];
        }
        if (!this.gamedatas.weatherPlayedBonus) this.gamedatas.weatherPlayedBonus = {};
        this.gamedatas.weatherPlayedBonus[card.id] = card;

        this.refreshAllPlayerPanels();

        if (args.player_id == this.bga.players.getCurrentPlayerId() && this.bga.states.getCurrentMainStateName() === 'WeatherPhaseBonus') {
             this.weatherPhaseBonus.onPlayerActivationChange(null, true);
        }
    }

    async notif_characterClaimed(args) {
        const cardId = args.card.id;
        const cardEl = document.getElementById(`character_${cardId}`);
        if (cardEl) {
            const garden = document.getElementById(`player-garden-planters-${args.player_id}`);
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

    async notif_playerDiscardedCards(args) {
        if (args && args.player_id != null && args.qty != null) {
            if (!this.gamedatas.handCounts) this.gamedatas.handCounts = {};
            this.gamedatas.handCounts[args.player_id] = Math.max(0,
                (this.gamedatas.handCounts[args.player_id] || 0) - args.qty);
            this.refreshAllPlayerPanels();
        }
    }

    async notif_playerUsedBananaAbility(args) {
        if (args && args.handCounts) {
            if (!this.gamedatas.handCounts) this.gamedatas.handCounts = {};
            Object.assign(this.gamedatas.handCounts, args.handCounts);
            this.refreshAllPlayerPanels();
        }
    }

    async notif_receivedWeatherCards(args) {
        if (!this.gamedatas.weatherHand) {
            this.gamedatas.weatherHand = {};
        }
        // Only character weather cards live in the private weatherHand.
        // Bonus weather cards (card.type === 'bonus') are publicly held in
        // weather_public_bonus and arrive via notif_playerGainedWeather or
        // notif_playerReceivedWeather. See https://trello.com/c/B5g3UmED.
        Object.values(args.cards).forEach(c => {
            if (c.type !== 'bonus') {
                this.gamedatas.weatherHand[c.id] = c;
            }
        });
        this.renderHand(this.gamedatas.hand, this.gamedatas.weatherHand);
        this.refreshAllPlayerPanels();
    }

    async notif_weatherCardsDrawn(args) {
        // Private notif when a plant effect grants the player a Bonus
        // Weather card. The card is publicly held — the visual update is
        // handled by notif_playerGainedWeather; this handler just keeps
        // the panel in sync if it arrives independently.
        this.refreshAllPlayerPanels();
    }

    async notif_playerGainedWeather(args) {
        // Public broadcast when any player gains a Bonus Weather card from
        // a plant effect. Bonus Weather is counted (weatherPublicBonus +
        // the player panel's Sun/Rain/Wind tally), not displayed as a
        // garden tile. See https://trello.com/c/uiJWdVTg.
        const card = args && args.card;
        if (card) {
            if (!this.gamedatas.weatherPublicBonus) this.gamedatas.weatherPublicBonus = {};
            this.gamedatas.weatherPublicBonus[card.id] = card;
        }
        if (args.bonusMarket) {
            this.gamedatas.bonusWeatherMarket = args.bonusMarket;
            this.renderBonusWeatherMarket(args.bonusMarket, 'bonus-weather-container');
        }
        this.refreshAllPlayerPanels();
    }

    async notif_playerReceivedWeather(args) {
        if (args.bonusMarket) {
            this.gamedatas.bonusWeatherMarket = args.bonusMarket;
            this.renderBonusWeatherMarket(this.gamedatas.bonusWeatherMarket, 'bonus-weather-container');
        }
        // Mushroom's distribute-time bonus cards arrive publicly here so
        // every player's tally stays accurate. Counted only — not
        // displayed as garden tiles. See https://trello.com/c/uiJWdVTg.
        const bonusCards = args.bonusCards || [];
        if (bonusCards.length > 0) {
            if (!this.gamedatas.weatherPublicBonus) this.gamedatas.weatherPublicBonus = {};
            bonusCards.forEach(card => {
                this.gamedatas.weatherPublicBonus[card.id] = card;
            });
            this.refreshAllPlayerPanels();
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
        this.renderPublicWeather(this.gamedatas.weatherPublic);

        // Per https://trello.com/c/B5g3UmED: end-of-phase cleanup clears only
        // the played-this-round pool. Held bonus weather (weather_public_bonus)
        // persists across rounds. The server sends the new held state via
        // args.weatherPublicBonus to keep clients' counts in sync. Bonus
        // Weather is counted only, never rendered as garden tiles — see
        // https://trello.com/c/uiJWdVTg.
        this.gamedatas.weatherPlayedBonus = {};

        if (args.weatherPublicBonus !== undefined) {
            this.gamedatas.weatherPublicBonus = args.weatherPublicBonus || {};
        }

        if (args.bonusMarket) {
            this.gamedatas.bonusWeatherMarket = args.bonusMarket;
            this.renderBonusWeatherMarket(args.bonusMarket, 'bonus-weather-container');
        }
        this.refreshAllPlayerPanels();
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
        // Drawing a card fires BOTH this private notif (to the drawer only,
        // carrying the actual card data) and the public playerDrewCard notif
        // (to every client, including the drawer's). handCounts must only be
        // incremented in ONE of them, or the drawer's own client double-counts
        // their own draw — see https://trello.com/c/vjsQX06a. playerDrewCard
        // is the single point of truth here, same pattern as
        // notif_keptCards/notif_playerKeptDraft below.
        this.renderHand(this.gamedatas.hand, this.gamedatas.weatherHand);
        this.refreshAllPlayerPanels();
    }

    async notif_playerDrewCard(args) {
        if (args && args.player_id) {
            if (!this.gamedatas.handCounts) this.gamedatas.handCounts = {};
            this.gamedatas.handCounts[args.player_id] = (this.gamedatas.handCounts[args.player_id] || 0) + (args.qty || 1);
            this.refreshAllPlayerPanels();
        }
    }

    async notif_playerGainedAction(args) {
        if (args.player_id == this.bga.players.getCurrentPlayerId()) {
            // Ready=0 still matters here — it's the real, server-authoritative
            // way out of ResolvingEffects=3 (see PlantingPlayerSubstate.php).
            // justActed=false is separate: this player just gained a fresh
            // action, so any earlier "I just acted" optimistic waiting must
            // be cleared too.
            this.gamedatas.players[args.player_id].planting_status = 0;
            this.gamedatas.players[args.player_id].pending_effects = '[]';
            this.plantingPhase.justActed = false;
            if (this.bga.states.getCurrentMainStateName() === 'PlantingPhase') {
                this.plantingPhase.onEnteringState(null, true);
            }
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

        // A Treevolved plant is paid for by sacrificing an existing Baby (or
        // Treevolved) plant from the garden, not a hand card — the server
        // already discarded it (PlantingPhase::actPlant), but the client's
        // DOM element and gamedatas entry for it are still there. Left
        // alone, the new adult gets appended on top of it (renderPlantInPlanter
        // only ever appends, never clears a slot first) and the old card
        // peeks out from behind. See https://trello.com/c/wVzDccUu. Safe to
        // run unconditionally: for a Baby plant, payment_card_ids are hand
        // card ids that were never in plantsOnPlanters/plantsLevel3, so this
        // is a no-op.
        (args.payment_card_ids || []).forEach(pid => {
            if (this.gamedatas.plantsOnPlanters) delete this.gamedatas.plantsOnPlanters[pid];
            if (this.gamedatas.plantsLevel3) delete this.gamedatas.plantsLevel3[pid];
            const staleEl = document.getElementById(`garden_plant_${pid}`);
            if (staleEl) staleEl.remove();
        });

        // Add to plantsOnPlanters
        if (!this.gamedatas.plantsOnPlanters) this.gamedatas.plantsOnPlanters = {};
        this.gamedatas.plantsOnPlanters[card.id] = card;

        // Render the plant in the planter
        this.renderPlantInPlanter(card, planterId);

        // Adjust local handCounts for the planter: 1 for the planted card, plus
        // the payment cards (for Baby plants — Treevolved sacrifices a garden
        // plant, not a hand card).
        if (!this.gamedatas.handCounts) this.gamedatas.handCounts = {};
        const cardInfo = (this.gamedatas.plantCardTypes || {})[card.type];
        const isBabyPlant = cardInfo && this.isBabyType(cardInfo.plant_type);
        const handCardsConsumed = 1 + (isBabyPlant ? (args.payment_card_ids || []).length : 0);
        this.gamedatas.handCounts[args.player_id] = Math.max(0,
            (this.gamedatas.handCounts[args.player_id] || 0) - handCardsConsumed);
        this.refreshAllPlayerPanels();

        if (args.player_id == this.bga.players.getCurrentPlayerId()) {
            // justActed=true, then onPlayerActivationChange directly — NOT
            // onEnteringState, which would immediately reset justActed back
            // to false (it's meant for fresh state entry, not a
            // just-acted confirmation). Same pattern as
            // notif_playerPlayedBonus for WeatherPhaseBonus.
            this.plantingPhase.justActed = true;
            if (this.bga.states.getCurrentMainStateName() === 'PlantingPhase') {
                this.plantingPhase.onPlayerActivationChange(null, true);
            }
        }
    }

    async notif_plantGrown(args) {
        const cardId = args.card_id;
        const level = args.level;

        // Update data
        if (this.gamedatas.plantsOnPlanters && this.gamedatas.plantsOnPlanters[cardId]) {
            this.gamedatas.plantsOnPlanters[cardId].type_arg = level;

            const el = document.getElementById(`garden_plant_${cardId}`);
            if (el) {
                // The CSS rule .plantopia-plant-on-planter[data-level="N"]
                // controls the card's vertical slide (top offset), revealing
                // the planter's current-level number underneath; the
                // transition animates the move. See https://trello.com/c/gcQP1950.
                el.setAttribute('data-level', String(Math.max(0, Math.min(3, level))));
            }

            if (args.max_level) {
                // Move off planter to the level-3 tilted area. The plant card
                // graduates from the sliding planter overlay to a full-size,
                // 90°-tilted tile sitting in the garden (no planter).
                const card = this.gamedatas.plantsOnPlanters[cardId];
                delete this.gamedatas.plantsOnPlanters[cardId];
                if (!this.gamedatas.plantsLevel3) this.gamedatas.plantsLevel3 = {};
                this.gamedatas.plantsLevel3[cardId] = card;

                if (el) {
                    el.classList.remove('plantopia-plant-on-planter');
                    el.classList.add('level3-tilted', 'plantopia-card-size');
                    el.style.cssText = 'position: relative; border: 2px solid #2ecc71; border-radius: 5px; background-color: #e8f8f5; text-align: center; display: flex; flex-direction: column; justify-content: center; transform: rotate(90deg); margin: 0 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);';
                    // Moves to the player's OWN dedicated tilted-plants row,
                    // underneath their planters row, per
                    // https://trello.com/c/gcQP1950.
                    const tiltedRow = document.getElementById(`player-garden-tilted-${args.player_id}`);
                    if (tiltedRow) tiltedRow.appendChild(el);
                }
            }
        }
        this.refreshAllPlayerPanels();

        if (args.player_id == this.bga.players.getCurrentPlayerId()) {
            // See notif_plantPlanted above for why onPlayerActivationChange,
            // not onEnteringState.
            this.plantingPhase.justActed = true;
            if (this.bga.states.getCurrentMainStateName() === 'PlantingPhase') {
                this.plantingPhase.onPlayerActivationChange(null, true);
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
        // The player kept cards from the draft → handCount up by that many.
        // Tracked via the public playerKeptDraft notif so opponents' panels
        // update too.
    }

    async notif_playerKeptDraft(args) {
        if (args && args.player_id != null && args.qty != null) {
            if (!this.gamedatas.handCounts) this.gamedatas.handCounts = {};
            this.gamedatas.handCounts[args.player_id] = (this.gamedatas.handCounts[args.player_id] || 0) + args.qty;
            this.refreshAllPlayerPanels();
        }
        if (args.player_id == this.bga.players.getCurrentPlayerId()) {
            // See notif_plantPlanted above for why onPlayerActivationChange,
            // not onEnteringState.
            this.plantingPhase.justActed = true;
            if (this.bga.states.getCurrentMainStateName() === 'PlantingPhase') {
                this.plantingPhase.onPlayerActivationChange(null, true);
            }
        }
    }

    renderPlantInPlanter(card, planterId) {
        // Appended into the SLOT wrapper (not the inner planter div) so the
        // card has the wrapper's extra headroom to slide into without being
        // clipped. See renderPlanters and https://trello.com/c/gcQP1950.
        const slotEl = document.getElementById(`planter-slot_${planterId}`);
        if (!slotEl) return;

        const cardInfo = this.gamedatas.plantCardTypes[card.type];
        // Full-size card (same as every other card on screen), slid
        // vertically up the planter as the plant levels up so the
        // planter's current-level number peeks out underneath while
        // higher numbers stay covered. See https://trello.com/c/gcQP1950.
        const level = Math.max(0, Math.min(3, parseInt(card.type_arg, 10) || 0));
        const body = this.plantCardBody(card.type, cardInfo, { levelLabel: `Level: ${level}` });
        slotEl.insertAdjacentHTML('beforeend', `
            <div id="garden_plant_${card.id}"
                 class="plantopia-plant-on-planter plantopia-card-size ${body.extraClass}"
                 ${body.dataAttr}
                 data-id="${card.id}"
                 data-level="${level}"
                 style="border: 2px solid #2ecc71; border-radius: 10px; padding: 10px; text-align: center; background-color: #e8f8f5; display: flex; flex-direction: column; justify-content: center; box-shadow: 2px 2px 5px rgba(0,0,0,0.1);">
                ${body.inner}
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
