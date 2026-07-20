/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Plantopia implementation : © Marty Chang <marty.y.chang@gmail.com>
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

            // Highlight the player's own claimed character icon (player
            // panel, see renderPlayerPanel) to return it. Used to target
            // the full card in the garden row before it moved to a small
            // panel icon — see https://trello.com/c/Zn3wKWxj.
            const myIcon = document.getElementById(`character-icon-${this.bga.players.getCurrentPlayerId()}`);
            if (myIcon) {
                myIcon.classList.add('bga-cards_selectable-card');
                myIcon.style.cursor = 'pointer';
                myIcon.style.boxShadow = '0 0 10px #e74c3c';
                myIcon.onclick = () => this.onReturnCharacter(myIcon.dataset.id);
            }
        }
    }

    onLeavingState(args, isCurrentPlayerActive) {
        // Clean up click handlers on the selection panel's full cards. That
        // panel (#characters-panel) gets hidden entirely right below, so
        // resetting cursor to 'default' is harmless — the elements go
        // invisible anyway.
        document.querySelectorAll('.character-card').forEach(el => {
            el.classList.remove('bga-cards_selectable-card');
            el.style.cursor = 'default';
            el.style.boxShadow = 'none';
            el.onclick = null;
        });
        // Same cleanup for the player panel's small return-icon (Trello
        // https://trello.com/c/Zn3wKWxj) — EXCEPT the icon stays visible
        // for the rest of the game, so its cursor reverts to 'help' (its
        // normal hover-for-tooltip cue) rather than 'default'.
        document.querySelectorAll('.plantopia-character-icon').forEach(el => {
            el.classList.remove('bga-cards_selectable-card');
            el.style.cursor = 'help';
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
        // Resync from getArgs() rather than trusting whatever the
        // cardsDrawn notification (fired by the immediately preceding
        // PlantingPhaseUpkeep state) already applied — same "sync via
        // getArgs() on state entry" pattern as WeatherPhaseBonus/
        // WeatherPhaseChoose. Explicitly re-render, since the whole point
        // is not depending on the notification having already done so.
        // See https://trello.com/c/61uLM9hR.
        if (args && args.hand !== undefined) {
            this.game.gamedatas.hand = args.hand;
            this.game.renderHand(this.game.gamedatas.hand, this.game.gamedatas.weatherHand);
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
        const sacrificeContainer = document.getElementById('sacrifice-container');
        if (sacrificeContainer) sacrificeContainer.remove();
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
                        this.bga.statusBar.setTitle(_('Select a plant to treevolve (sacrifice)'));
                        this.renderSacrificeModal(cardInfo, id => {
                            this.selectedPaymentCards = [id];
                            this.updateStatusBar();
                        });
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

    /**
     * Sacrifice-picker modal for planting a Treevolved (adult) plant
     * (Trello https://trello.com/c/xYfPLZuI). Modeled on renderDraftModal's
     * "Draw X Keep Y" pattern (same modal shell, same select-then-Confirm
     * status-bar flow), replacing the old highlightGardenPlantsForCost,
     * which highlighted and clicked candidate cards directly in the
     * garden. That approach broke for Level 3 candidates once Level 3
     * plants stopped rendering in the garden at all (see the same card) —
     * and mixing "click in the garden" for planter-level candidates with
     * "click in a modal" for Level 3 ones would have been an inconsistent
     * experience anyway, so EVERY sacrifice candidate (still on a planter
     * or already Level 3) now goes through this one modal.
     *
     * Single-select, unlike renderDraftModal's multi-select: clicking a
     * candidate toggles it (gold highlight); clicking a different one
     * moves the highlight. Confirm only appears once something is
     * selected, and calls onSelect(cardId) — matching the "add the button
     * only when ready" pattern used everywhere else in this file.
     *
     * The status bar's "Cancel" button (added by the caller in
     * updateStatusBar's 'plant' branch) must stay available throughout —
     * unlike renderDraftModal's caller, which doesn't offer a Cancel at
     * that point — so updateConfirmButton re-adds it every time it clears
     * the status bar, rather than only adding Confirm.
     */
    renderSacrificeModal(trvCardInfo, onSelect) {
        this.cleanupUI();
        const pId = this.bga.players.getCurrentPlayerId();
        const candidates = [
            ...Object.values(this.game.gamedatas.plantsOnPlanters || {}).filter(pl => {
                const planter = this.game.gamedatas.planters[pl.location_arg];
                return planter && planter.location_arg == pId;
            }),
            ...Object.values(this.game.gamedatas.plantsLevel3 || {}).filter(pl => pl.location_arg == pId),
        ].filter(pl => {
            const typeInfo = this.game.gamedatas.plantCardTypes[pl.type];
            return typeInfo && pl.type_arg >= trvCardInfo.cost
                && this.game.getFamily(typeInfo.plant_type) === this.game.getFamily(trvCardInfo.cost_unit);
        });

        let selectedId = null;

        this.bga.gameArea.getElement().insertAdjacentHTML('afterbegin', `
            <div id="sacrifice-container" style="padding: 20px; background: rgba(0,0,0,0.8); border-radius: 10px; margin-bottom: 20px; text-align: center; color: white;">
                <h2>Choose a Plant to Sacrifice</h2>
                <div style="display: flex; justify-content: center; flex-wrap: wrap; gap: 15px; margin-top: 15px;" id="sacrifice-cards-list"></div>
            </div>
        `);

        const list = document.getElementById('sacrifice-cards-list');

        const updateConfirmButton = () => {
            this.bga.statusBar.removeActionButtons();
            this.bga.statusBar.addActionButton(_('Cancel'), () => { this.resetSelection(); this.updateStatusBar(); }, { color: 'gray' });
            if (selectedId != null) {
                this.bga.statusBar.addActionButton(_('Confirm'), () => {
                    document.getElementById('sacrifice-container').remove();
                    onSelect(selectedId);
                }, { color: 'blue' });
            }
        };

        candidates.forEach(pl => {
            const typeInfo = this.game.gamedatas.plantCardTypes[pl.type];
            const body = this.game.plantCardBody(pl.type, typeInfo, { levelLabel: `Level: ${pl.type_arg}` });
            list.insertAdjacentHTML('beforeend', `
                <div id="sacrifice_${pl.id}" class="bga-cards_selectable-card plant-card plantopia-card-size ${body.extraClass}" ${body.dataAttr} style="position: relative; border: 2px solid #2ecc71; border-radius: 10px; padding: 10px; background-color: #e8f8f5; color: black; display: flex; flex-direction: column; justify-content: center; cursor: pointer; box-shadow: 0 0 10px #27ae60;">
                    ${body.inner}
                </div>
            `);

            this.game.addPlantTooltip(`sacrifice_${pl.id}`, typeInfo);

            const el = document.getElementById(`sacrifice_${pl.id}`);
            el.onclick = () => {
                if (selectedId === pl.id) {
                    selectedId = null;
                    el.style.boxShadow = '0 0 10px #27ae60';
                    el.style.border = '2px solid #2ecc71';
                } else {
                    if (selectedId != null) {
                        const prevEl = document.getElementById(`sacrifice_${selectedId}`);
                        if (prevEl) { prevEl.style.boxShadow = '0 0 10px #27ae60'; prevEl.style.border = '2px solid #2ecc71'; }
                    }
                    selectedId = pl.id;
                    el.style.boxShadow = '0 0 15px #f1c40f';
                    el.style.border = '4px solid #f1c40f';
                }
                updateConfirmButton();
            };
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
            // Modeled after WeatherPhaseChoose's Sun/Rain/Wind buttons (Trello
            // https://trello.com/c/XZgYk9h9) — every button blue with an
            // emoji, instead of a different color per family (which read as
            // confusing rather than informative; see the card's screenshot).
            this.bga.statusBar.setTitle(_('Choose a plant family to grow'));
            this.bga.statusBar.addActionButton(_('🌲 Tree'), () => this.bga.actions.performAction("actResolveLevelUpFamily", { family: 'tree' }), { color: 'blue' });
            this.bga.statusBar.addActionButton(_('🌹 Flower'), () => this.bga.actions.performAction("actResolveLevelUpFamily", { family: 'flower' }), { color: 'blue' });
            this.bga.statusBar.addActionButton(_('🌵 Cactus'), () => this.bga.actions.performAction("actResolveLevelUpFamily", { family: 'cactus' }), { color: 'blue' });
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
        // Resync from getArgs() rather than trusting whatever the
        // receivedWeatherCards notification (fired a full PlantingPhase
        // round earlier, by WeatherPhaseGrow) already applied. See
        // https://trello.com/c/61uLM9hR.
        if (args && args.weatherHand !== undefined) {
            this.game.gamedatas.weatherHand = args.weatherHand;
        }
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
                    // Apply immediately — don't wait for the server
                    // round-trip / playerPlayedBonus notification. Once a
                    // card is added to this turn's selection it WILL be
                    // played (submitSelectedBonusCards sends the whole
                    // selection, and there's no way to deselect), so it's
                    // safe to show it as played right away: garden tile +
                    // player panel count drop. Without this, the status
                    // button for this condition already disappears (real
                    // local state), but the panel and garden looked
                    // unchanged until the WHOLE selection was submitted —
                    // see https://trello.com/c/rvSEQag1.
                    this.game.applyBonusWeatherPlayed(card, pId);
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

            // Two dedicated, always-overflowing rows instead of one shared
            // flex row (Trello https://trello.com/c/gcQP1950 follow-up):
            // planters+character, then bonus weather. See
            // .plantopia-overflow-row in the CSS. Level 3 (Treevolved)
            // plants no longer get a row here at all — they're hidden from
            // the garden entirely and surfaced via a tooltip on the player
            // panel's Lv. 3 counters instead (Trello
            // https://trello.com/c/xYfPLZuI), to conserve vertical space.
            //
            // Explicit `color: #333` alongside this section's own light
            // background — BGA's dark mode flips the page's DEFAULT text
            // color to something light, but doesn't touch this container's
            // deliberately-light rgba(255,255,255,0.8) backdrop, so the
            // heading below went white-on-near-white and unreadable in dark
            // mode until this was added. Same fix applied to the Bonus
            // Weather / Public Weather Cards sections below. Pair an
            // explicit color with any explicit background, the way the
            // draft-keep modal already does (`color: white` on its own dark
            // rgba(0,0,0,0.8) backdrop) — never rely on the page's
            // light/dark default. See https://trello.com/c/CUKgx2vL.
            document.getElementById('player-tables').insertAdjacentHTML('beforeend', `
                <div id="player-table-${player.id}" style="border: 1px solid #ccc; margin: 10px; padding: 10px; background: rgba(255,255,255,0.8); border-radius: 8px; color: #333;">
                    <h3>${player.name}'s Garden</h3>
                    <div id="player-garden-planters-${player.id}" class="plantopia-overflow-row" style="margin-top: 10px; min-height: 300px;"></div>
                    <div id="player-garden-bonus-${player.id}" class="plantopia-overflow-row" style="margin-top: 10px;"></div>
                </div>
            `);

            // Render planters for this player
            const planters = Object.values(gamedatas.planters || {}).filter(c => c.location_arg == player.id);
            this.renderPlanters(planters, `player-garden-planters-${player.id}`);

            // A claimed character no longer renders as a full card here in
            // the garden row — it's now a small icon in the player panel
            // (see renderPlayerPanel) per https://trello.com/c/Zn3wKWxj.

            // Render this player's Bonus Weather cards played so far THIS
            // round, AFTER the planters. See https://trello.com/c/rvSEQag1.
            const playedBonus = Object.values(gamedatas.weatherPlayedBonus || {}).filter(c => c.location_arg == player.id);
            this.renderPlayedBonusWeather(playedBonus, `player-garden-planters-${player.id}`);

            // Level 3 (Treevolved) plants are NOT rendered into the garden
            // at all — see the comment above the player-table template.
            // gamedatas.plantsLevel3 is still tracked and drives the player
            // panel's Lv. 3 counts + hover tooltips (renderPlayerPanel).
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
            <div id="bonus-weather-section" style="border: 1px solid #ccc; margin: 10px; padding: 10px; background: rgba(255,255,255,0.8); border-radius: 8px; color: #333;">
                <h3 style="margin-top: 0;">Bonus Weather</h3>
                <div id="bonus-weather-container" style="display: flex; gap: 10px; margin-top: 10px; min-height: 150px;"></div>
            </div>
        `);

        if (gamedatas.bonusWeatherMarket) {
            this.renderBonusWeatherMarket(gamedatas.bonusWeatherMarket, 'bonus-weather-container');
        }

        // Add a Public Weather section
        document.getElementById('bonus-weather-section').insertAdjacentHTML('beforebegin', `
            <div id="public-weather-section" style="border: 1px solid #ccc; margin: 10px; padding: 10px; background: rgba(255,255,255,0.8); border-radius: 8px; color: #333;">
                <h3 style="margin-top: 0;">Public Weather Cards</h3>
                <div id="weather-public-container" style="display: flex; gap: 10px; margin-top: 10px; min-height: 150px;"></div>
            </div>
        `);

        if (gamedatas.weatherPublic) {
            this.renderPublicWeather(gamedatas.weatherPublic);
        }

        // Add a dedicated hand panel for the current player, placed above the
        // player gardens so it's visible without scrolling past every player's
        // garden first. Spectators have no hand of their own — skip the
        // section entirely rather than showing an always-empty "My Hand"
        // (previously showed up as an odd, permanently-empty artifact for
        // spectators). renderHand() (called right below, and again from
        // several notif_* handlers throughout play) already no-ops safely
        // when #my-hand-container doesn't exist, so this has no effect on
        // real players — only spectators ever skip creating the panel.
        // See https://trello.com/c/pbg3MAI0.
        if (!this.bga.players.isCurrentPlayerSpectator()) {
            document.getElementById('player-tables').insertAdjacentHTML('beforebegin', `
                <div id="hand_panel" style="margin-bottom: 20px; border: 2px solid #27ae60; border-radius: 8px; background: rgba(255, 255, 255, 0.9); padding: 15px;">
                    <h3 style="color: #27ae60; margin-top: 0;">My Hand</h3>
                    <div id="my-hand-container" style="display: flex; flex-wrap: wrap; gap: 15px;"></div>
                </div>
            `);
        }

        // Setup the current player's hand
        this.renderHand(gamedatas.hand, gamedatas.weatherHand);
        
        // TODO: Set up your game interface here, according to "gamedatas"
        

        // Setup game notifications to handle (see "setupNotifications" method below)
        this.setupNotifications();

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

    /**
     * A player's PLAYED (not held) Bonus Weather cards for the current
     * round, shown to the right of their planters in the same garden row
     * (claimed characters no longer render into this row at all — they're
     * a small icon in the player panel instead, see
     * https://trello.com/c/Zn3wKWxj — so this now lands right after the
     * planters). Idempotent: skips any card id that already has a rendered element,
     * so it's safe to call both optimistically (the instant a player
     * chooses to play a card) and again when the server confirms via
     * notif_playerPlayedBonus — see applyBonusWeatherPlayed. Cleared by
     * notif_weatherCleared once WeatherPhaseGrow returns these cards to
     * the supply. See https://trello.com/c/rvSEQag1.
     */
    renderPlayedBonusWeather(cards, containerId) {
        const container = document.getElementById(containerId);
        if (!container || !cards) return;

        cards.forEach(card => {
            if (document.getElementById(`garden_weatherbonus_${card.id}`)) return;
            const body = this.weatherCardBody(card, { name: 'Bonus Weather' });
            container.insertAdjacentHTML('beforeend', `
                <div id="garden_weatherbonus_${card.id}" class="weather-card plantopia-card-size ${body.extraClass}" ${body.dataAttr} data-id="${card.id}" style="position: relative; border: 2px solid #3498db; border-radius: 10px; background-color: #ebf5fb; box-shadow: 2px 2px 5px rgba(0,0,0,0.1);"></div>
            `);
        });
    }

    /**
     * Single funnel for "this Bonus Weather card is now played" — moves it
     * from held to played in gamedatas, renders its garden tile, and
     * refreshes player panels (so the held count drops immediately).
     * Idempotent (see renderPlayedBonusWeather), so it's safe to call both
     * optimistically, right when WeatherPhaseBonus's status button is
     * clicked (before the server round-trip confirms it — the player's
     * own click can't end up NOT playing the card, since it's already
     * been added to that turn's selection), and again from
     * notif_playerPlayedBonus when the server does confirm. Without the
     * optimistic call, the player panel's held count and this garden tile
     * wouldn't update until the WHOLE selection was submitted (Done /
     * auto-submit), even though the status button for that condition had
     * already disappeared — see https://trello.com/c/rvSEQag1.
     */
    applyBonusWeatherPlayed(card, playerId) {
        if (this.gamedatas.weatherPublicBonus) delete this.gamedatas.weatherPublicBonus[card.id];
        if (!this.gamedatas.weatherPlayedBonus) this.gamedatas.weatherPlayedBonus = {};
        this.gamedatas.weatherPlayedBonus[card.id] = card;
        this.renderPlayedBonusWeather([card], `player-garden-planters-${playerId}`);
        this.refreshAllPlayerPanels();
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
        baby_cactus: 'Baby Cactus in garden, by level',
        adult_cactus: 'Adult Cactus in garden, by level',
        baby_flower: 'Baby Flower in garden, by level',
        adult_flower: 'Adult Flower in garden, by level',
        baby_tree: 'Baby Tree in garden, by level',
        adult_tree: 'Adult Tree in garden, by level',
        sun: 'Bonus Sun Weather cards held',
        rain: 'Bonus Rain Weather cards held',
        wind: 'Bonus Wind Weather cards held',
    };

    /**
     * Column order for the compact plant-counts table (Trello
     * https://trello.com/c/cPxcQy2A): baby/adult pairs for tree, flower,
     * then cactus, each keyed to its per-level count array from
     * computePlayerStats (index = level 0-3) and its player-panel icon.
     */
    static PLANT_COUNT_COLUMNS = [
        { icon: 'baby_tree', family: 'tree', maturity: 'baby' },
        { icon: 'adult_tree', family: 'tree', maturity: 'adult' },
        { icon: 'baby_flower', family: 'flower', maturity: 'baby' },
        { icon: 'adult_flower', family: 'flower', maturity: 'adult' },
        { icon: 'baby_cactus', family: 'cactus', maturity: 'baby' },
        { icon: 'adult_cactus', family: 'cactus', maturity: 'adult' },
    ];

    /**
     * Compact column-based plant-counts table (Trello
     * https://trello.com/c/cPxcQy2A), replacing the old text-line-per-
     * family layout. 7 columns (the 6 baby/adult × tree/flower/cactus
     * columns above, THEN the level label last — Marty moved the label
     * column from left to right on 2026-07-19), 5 rows (Lv. 3 / Lv. 2 /
     * Lv. 1 / Lv. 0 counts, then a label-less row of family icons). Marty
     * initially proposed 4 rows (no Lv. 0), self-corrected once he
     * remembered plants start at level 0 when first planted (2026-07-18)
     * — Lv. 0 counts are NOT always zero. Zero counts render as blank
     * cells, not "0", per the card.
     *
     * The Lv. 3 row's cells get a deterministic id (see level3CellId)
     * regardless of count — Level 3 plants no longer render in the garden
     * at all (Trello https://trello.com/c/xYfPLZuI), so this row is the
     * only place a hover tooltip can show which actual cards make up
     * each count. renderPlayerPanel wires the tooltips AFTER this HTML is
     * inserted into the DOM (a tooltip needs its target node to already
     * exist), via level3CardsByColumn.
     */
    plantCountsTableHtml(s, playerId) {
        const icon = (name) => `<span class="plantopia-panel-icon" data-icon="${name}" title="${Game.PANEL_ICON_TOOLTIPS[name] || ''}"></span>`;
        const cols = Game.PLANT_COUNT_COLUMNS;
        const levelRows = [3, 2, 1, 0].map(level => {
            const cells = cols.map(c => {
                const n = s.plants[c.family][c.maturity][level];
                const idAttr = level === 3 ? ` id="${this.level3CellId(playerId, c.icon)}"` : '';
                return `<td${idAttr}>${n > 0 ? n : ''}</td>`;
            }).join('');
            return `<tr>${cells}<td class="plantopia-panel-level-label">Lv. ${level}</td></tr>`;
        }).join('');
        const iconRow = `<tr>${cols.map(c => `<td>${icon(c.icon)}</td>`).join('')}<td></td></tr>`;
        return `<table class="plantopia-panel-table">${levelRows}${iconRow}</table>`;
    }

    /** Deterministic DOM id for one Lv. 3 cell, shared between
     * plantCountsTableHtml (which embeds it) and the tooltip-wiring pass
     * in renderPlayerPanel (which looks it up) — see
     * https://trello.com/c/xYfPLZuI. */
    level3CellId(playerId, columnIcon) {
        return `lv3-cell-${playerId}-${columnIcon}`;
    }

    /**
     * This player's Level 3 (Treevolved) plants, grouped by the same 6
     * columns as PLANT_COUNT_COLUMNS — the actual cards behind each Lv. 3
     * count, for the player panel's hover tooltips (Trello
     * https://trello.com/c/xYfPLZuI), since those plants no longer render
     * anywhere in the garden.
     */
    level3CardsByColumn(playerId) {
        const byColumn = {};
        Game.PLANT_COUNT_COLUMNS.forEach(c => { byColumn[c.icon] = []; });
        Object.values(this.gamedatas.plantsLevel3 || {}).forEach(card => {
            if (card.location_arg != playerId) return;
            const info = (this.gamedatas.plantCardTypes || {})[card.type];
            if (!info) return;
            const family = this.getFamily(info.plant_type);
            const maturity = this.isAdult(info.plant_type) ? 'adult' : (this.isBabyType(info.plant_type) ? 'baby' : null);
            if (!family || !maturity) return;
            const col = Game.PLANT_COUNT_COLUMNS.find(c => c.family === family && c.maturity === maturity);
            if (col) byColumn[col.icon].push(card);
        });
        return byColumn;
    }

    /** Tooltip listing the actual card name(s) behind a Lv. 3 cell's
     * count. Same addTooltipHtml primitive as addPlantTooltip/
     * addCharacterTooltip, just with a card LIST instead of a single card
     * — see https://trello.com/c/xYfPLZuI. */
    addLevel3Tooltip(nodeId, cards) {
        if (!cards || !cards.length) return;
        const items = cards.map(card => {
            const info = (this.gamedatas.plantCardTypes || {})[card.type] || { name: card.type };
            return `<li>${info.name}</li>`;
        }).join('');
        const html = `<div class="cardtooltip"><ul style="margin: 0; padding-left: 18px;">${items}</ul></div>`;
        this.bga.gameui.addTooltipHtml(nodeId, html);
    }

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
        // Bonus weather counters sit alongside the hand count, per Marty's
        // Trello feedback (https://trello.com/c/3jIZmRy9).
        // "&nbsp;&nbsp;&nbsp;&nbsp;" is just breathing room between them.
        const gap = '&nbsp;&nbsp;&nbsp;&nbsp;';

        // Claimed character icon (Trello https://trello.com/c/Zn3wKWxj) —
        // small icon to the left of the hand count, in place of the
        // full-size card that used to sit in the garden row. Computed fresh
        // from gamedatas.claimedCharacters every render (same "resync from
        // data, not DOM" approach as the rest of this panel), so it stays
        // correct across notif_characterClaimed/Returned and page reloads
        // alike. '' before a character is claimed (early SetupDecisions).
        const claimed = Object.values(this.gamedatas.claimedCharacters || {}).find(c => c.location_arg == playerId);
        const characterIconHtml = claimed
            ? `<span id="character-icon-${playerId}" class="plantopia-character-icon" data-character-type="${claimed.type}" data-id="${claimed.id}"></span> `
            : '';

        el.innerHTML = `
            <div>${characterIconHtml}${icon('hand')} ${s.handCount}${gap}${icon('sun')} ${s.bonusWeather.sun}${gap}${icon('rain')} ${s.bonusWeather.rain}${gap}${icon('wind')} ${s.bonusWeather.wind}</div>
            ${this.plantCountsTableHtml(s, playerId)}
        `;

        // Hovering the icon shows the full-size card, via the same tooltip
        // helper used for the (still full-size) selection panel.
        if (claimed) {
            const cardInfo = this.gamedatas.characterCardTypes[claimed.type] || { name: claimed.type, ability: '' };
            this.addCharacterTooltip(`character-icon-${playerId}`, cardInfo);
        }

        // Hovering a Lv. 3 cell shows the actual card(s) behind that count
        // — Level 3 plants aren't rendered in the garden anymore (Trello
        // https://trello.com/c/xYfPLZuI), so this is the only place to see
        // them. Wired AFTER innerHTML is set, same as the character icon
        // tooltip above — addTooltipHtml needs its target node in the DOM.
        const level3ByColumn = this.level3CardsByColumn(playerId);
        Game.PLANT_COUNT_COLUMNS.forEach(c => {
            this.addLevel3Tooltip(this.level3CellId(playerId, c.icon), level3ByColumn[c.icon]);
        });
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
        // automatically listen to the notifications, based on the `notif_xxx` function on this class.
        this.bga.notifications.setupPromiseNotifications({});
    }
    
    // TODO: from this point and below, you can write your game notifications handling methods
    
    async notif_updateScores(args) {
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
        // The server sends the new hand when the player redraws
        this.gamedatas.hand = args.cards;
        const pId = this.bga.players.getCurrentPlayerId();
        if (!this.gamedatas.handCounts) this.gamedatas.handCounts = {};
        this.gamedatas.handCounts[pId] = Object.keys(args.cards || {}).length;
        this.renderHand(this.gamedatas.hand, this.gamedatas.weatherHand);
        this.refreshAllPlayerPanels();
    }

    async notif_potatoExtraCards(args) {
        const handCounts = args.handCounts || {};
        if (!this.gamedatas.handCounts) this.gamedatas.handCounts = {};
        Object.assign(this.gamedatas.handCounts, handCounts);
        this.refreshAllPlayerPanels();
    }

    async notif_mushroomBonusWeather(args) {
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

        // Per https://trello.com/c/B5g3UmED: playing a Bonus Weather card
        // moves it out of the player's public held stash and into the
        // round's played pool — the held count goes DOWN by 1, and it
        // renders in the player's garden (https://trello.com/c/rvSEQag1).
        // applyBonusWeatherPlayed is idempotent, so this is a safe no-op
        // re-application for the acting player's own client, which already
        // applied this optimistically the instant they clicked the status
        // button (see WeatherPhaseBonus below) — this call is what makes
        // it visible to every OTHER (observing) client.
        this.applyBonusWeatherPlayed(args.card, args.player_id);

        if (args.player_id == this.bga.players.getCurrentPlayerId() && this.bga.states.getCurrentMainStateName() === 'WeatherPhaseBonus') {
             this.weatherPhaseBonus.onPlayerActivationChange(null, true);
        }
    }

    /**
     * A claimed character no longer moves a DOM node between containers —
     * it's now a small icon computed fresh from gamedatas inside
     * renderPlayerPanel (see https://trello.com/c/Zn3wKWxj). So claiming
     * just updates gamedatas (available -> claimed) and re-renders the two
     * places that read it: the selection panel (card disappears from the
     * pool) and the claiming player's panel (icon appears).
     */
    async notif_characterClaimed(args) {
        const card = args.card;
        if (this.gamedatas.availableCharacters) delete this.gamedatas.availableCharacters[card.id];
        if (!this.gamedatas.claimedCharacters) this.gamedatas.claimedCharacters = {};
        this.gamedatas.claimedCharacters[card.id] = card;

        this.renderCharacters(Object.values(this.gamedatas.availableCharacters || {}), 'available-characters-container');
        this.renderPlayerPanel(args.player_id);

        // Re-evaluate current state handlers (adds clickable return if it's ours)
        if (this.bga.states.getCurrentMainStateName() === 'SetupDecisions') {
            this.setupDecisions.onEnteringState(null, this.bga.players.getCurrentPlayerId() === args.player_id);
        }
    }

    /** Mirror of notif_characterClaimed — moves the card back the other way. */
    async notif_characterReturned(args) {
        const card = args.card;
        if (this.gamedatas.claimedCharacters) delete this.gamedatas.claimedCharacters[card.id];
        if (!this.gamedatas.availableCharacters) this.gamedatas.availableCharacters = {};
        this.gamedatas.availableCharacters[card.id] = card;

        this.renderCharacters(Object.values(this.gamedatas.availableCharacters), 'available-characters-container');
        this.renderPlayerPanel(args.player_id);

        // Re-evaluate current state handlers (adds clickable claim)
        if (this.bga.states.getCurrentMainStateName() === 'SetupDecisions') {
            this.setupDecisions.onEnteringState(null, true);
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
        // args.weatherPublicBonus to keep clients' counts in sync.
        //
        // WeatherPhaseGrow has already moved every played-this-round Bonus
        // Weather card back to the supply server-side (weather_played_bonus
        // -> bonus_deck) by the time this notif fires — remove their garden
        // tiles (rendered by applyBonusWeatherPlayed while the round was in
        // progress — see https://trello.com/c/rvSEQag1) before clearing the
        // data they were keyed from.
        Object.keys(this.gamedatas.weatherPlayedBonus || {}).forEach(cardId => {
            const el = document.getElementById(`garden_weatherbonus_${cardId}`);
            if (el) el.remove();
        });
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

                // Regenerate the "Level: N" text badge on EVERY growth step,
                // not just the level-3/graduation one below — it's baked
                // into this element's innerHTML once, by plantCardBody, at
                // planting time ("Level: 0"), and the data-level attribute
                // update above only drives the sliding-reveal CSS
                // animation, it never touches that baked-in text. See
                // https://trello.com/c/UlEhJIr5. (The max_level branch
                // below used to be the ONLY place this got regenerated —
                // fixed for that one transition by
                // https://trello.com/c/7CO2tan1 — which is exactly why
                // level-3/tilted cards already showed the right number
                // while every intermediate step, 0→1 and 1→2, stayed
                // frozen at "Level: 0".)
                const cardInfo = this.gamedatas.plantCardTypes[this.gamedatas.plantsOnPlanters[cardId].type];
                if (cardInfo) {
                    const body = this.plantCardBody(this.gamedatas.plantsOnPlanters[cardId].type, cardInfo, { levelLabel: `Level: ${level}` });
                    el.innerHTML = body.inner;
                }
            }

            if (args.max_level) {
                // Graduate off the planter to Level 3 (Treevolved). Unlike
                // before https://trello.com/c/xYfPLZuI, this no longer
                // re-parents the card into a visible garden row — Level 3
                // plants aren't rendered in the garden at all now, only
                // surfaced via a tooltip on the player panel's Lv. 3
                // counters (see renderPlayerPanel / level3CardsByColumn) —
                // so the DOM element is simply removed.
                const card = this.gamedatas.plantsOnPlanters[cardId];
                delete this.gamedatas.plantsOnPlanters[cardId];

                // plantsOnPlanters entries use location_arg for "which
                // planter this plant sits on" (resolved to an owning player
                // via gamedatas.planters[locationArg].location_arg — see
                // computePlayerStats' planters loop). plantsLevel3 entries
                // use location_arg directly for "which player owns this
                // plant" instead, matching the server's own convention
                // (moveCard's $playerId argument in PlantingPhase.php/
                // WeatherPhaseGrow.php) — same field name, different
                // meaning depending on which collection it's in. Without
                // translating it here, every "does this belong to me"
                // check downstream (computePlayerStats, renderSacrificeModal)
                // compared this plant's stale planter id against a player id
                // and silently excluded it — from its own owner's
                // player-panel counts AND from being selectable as a
                // Treevolve sacrifice — until something forced a full
                // server resync (reload). See https://trello.com/c/7CO2tan1.
                card.location_arg = args.player_id;

                if (!this.gamedatas.plantsLevel3) this.gamedatas.plantsLevel3 = {};
                this.gamedatas.plantsLevel3[cardId] = card;

                if (el) el.remove();
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
