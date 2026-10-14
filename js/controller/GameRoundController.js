// Port of controller/GameRoundController.java (+ util/TimedMessageTask)
import { Constants, ListOfListeners, TimedMessageTask } from '../util.js';

export const PauseReason = { ACTIVITY_HIDDEN: 'ACTIVITY_HIDDEN', BLOCKING_DIALOG: 'BLOCKING_DIALOG', BLOCKING_ACTIVITY: 'BLOCKING_ACTIVITY', MAP_TRANSITION: 'MAP_TRANSITION' };

export class GameRoundController {
	constructor(controllers, world) {
		this.controllers = controllers;
		this.world = world;
		this.activePauses = new Set([PauseReason.ACTIVITY_HIDDEN]);
		this.gameRoundListeners = new ListOfListeners();
		this.ticksUntilNextRound = Constants.TICKS_PER_ROUND;
		this.ticksUntilNextFullRound = Constants.TICKS_PER_FULLROUND;
		this.roundTimer = new TimedMessageTask(this, Constants.TICK_DELAY, true);
		this.updateTimerState();
	}
	_startTimer() { this.roundTimer.start(); }
	_stopTimer() { this.roundTimer.stop(); }
	hasLoadedModel() { return this.world.model != null && this.world.model.uiSelections != null; }
	onTick() {
		if (!this.hasLoadedModel()) return false;
		if (this.activePauses.size) return false;
		const ui = this.world.model.uiSelections;
		if (!ui.isMainActivityVisible) return false;
		if (ui.isInCombat) return false;
		if (!this.world.model.currentMaps.tileMap) return false;
		this.onNewTick();
		if (--this.ticksUntilNextRound <= 0) { this.onNewRound(); this.ticksUntilNextRound = Constants.TICKS_PER_ROUND; }
		if (--this.ticksUntilNextFullRound <= 0) { this.onNewFullRound(); this.ticksUntilNextFullRound = Constants.TICKS_PER_FULLROUND; }
		return true;
	}
	resetRoundTimers() {
		this.ticksUntilNextRound = Constants.TICKS_PER_ROUND;
		this.ticksUntilNextFullRound = Constants.TICKS_PER_FULLROUND;
	}
	acquirePause(reason) { this.activePauses.add(reason); this.updateTimerState(); }
	releasePause(reason) {
		this.activePauses.delete(reason);
		this.updateTimerState();
		if (this.activePauses.size === 0) this.controllers.combatController.resumeCombatIfNeeded();
	}
	isPausedFor(reason) { return this.activePauses.has(reason); }
	onMainActivityPaused() { if (!this.activePauses.has(PauseReason.ACTIVITY_HIDDEN)) this.acquirePause(PauseReason.ACTIVITY_HIDDEN); }
	onMainActivityResumed() { if (this.activePauses.has(PauseReason.ACTIVITY_HIDDEN)) this.releasePause(PauseReason.ACTIVITY_HIDDEN); }
	onCombatStateChanged() { this.updateTimerState(); }
	updateTimerState() {
		if (!this.hasLoadedModel()) { this._stopTimer(); return; }
		this.world.model.uiSelections.isMainActivityVisible = this.activePauses.size === 0;
		if (this.activePauses.size || this.world.model.uiSelections.isInCombat) this._stopTimer();
		else this._startTimer();
	}
	onNewFullRound() {
		this.controllers.mapController.resetMapsNotRecentlyVisited();
		this.controllers.actorStatsController.applyConditionsToMonsters(this.world.model.currentMaps.map, true);
		this.controllers.actorStatsController.applyConditionsToPlayer(this.world.model.player, true);
		this.gameRoundListeners.emit('onNewFullRound');
	}
	onNewRound() {
		this.onNewMonsterRound();
		this.onNewPlayerRound();
		this.gameRoundListeners.emit('onNewRound');
	}
	onNewPlayerRound() {
		this.world.model.worldData.tickWorldTime();
		this.controllers.actorStatsController.applyConditionsToPlayer(this.world.model.player, false);
		this.controllers.actorStatsController.applySkillEffectsForNewRound(this.world.model.player, this.world.model.currentMaps.map);
		this.controllers.mapController.handleMapEvents(this.world.model.currentMaps.map, this.world.model.player.position, 'afterEveryRound');
	}
	onNewMonsterRound() {
		this.controllers.actorStatsController.applyConditionsToMonsters(this.world.model.currentMaps.map, false);
	}
	onNewTick() {
		const m = this.world.model.currentMaps;
		this.controllers.monsterMovementController.moveMonsters();
		this.controllers.monsterSpawnController.maybeSpawn(m.map, m.tileMap);
		this.controllers.monsterMovementController.attackWithAgressiveMonsters();
		this.controllers.effectController.updateSplatters(m.map);
		this.controllers.mapController.handleMapEvents(m.map, this.world.model.player.position, 'continuously');
		this.gameRoundListeners.emit('onNewTick');
	}
}
