// Port of controller/MapController.java
import { Constants, ListOfListeners, idiv } from '../util.js';
import { SC } from '../model.js';
import { ConversationController, ConversationStatemachine } from './ConversationController.js';
import { BeginTurnAs } from './CombatController.js';

export class MapController {
	constructor(controllers, world) {
		this.controllers = controllers;
		this.world = world;
		this.worldEventListeners = new ListOfListeners();
		this.mapLayoutListeners = new ListOfListeners();
		this.mapScriptExecutor = null;
		const self = this;
		this.conversationStateListener = {
			onTextPhraseReached(message, actor, phraseID) { self.worldEventListeners.emit('onScriptAreaStartedConversation', phraseID); },
			onScriptEffectsApplied() {}, onConversationEnded() {}, onConversationEndedWithShop() {},
			onConversationEndedWithCombat() {}, onConversationEndedWithRemoval() {},
			onConversationCanProceedWithNext() {}, onConversationHasReply() {},
		};
	}
	handleMapEventsAfterMovement(currentMap, newPosition, lastPosition) {
		const objects = currentMap.getActiveEventObjectsAt(newPosition);
		if (objects == null) return;
		for (const o of objects) {
			if (o.evaluateWhen === 'afterEveryRound') continue;
			if (o.evaluateWhen === 'whenEntering' && o.position.contains(lastPosition)) continue;
			this.handleMapEvent(o, newPosition);
		}
	}
	handleMapEvents(currentMap, position, evaluationType) {
		if (!currentMap) return;
		const objects = currentMap.getActiveEventObjectsAt(position);
		if (objects == null) return;
		for (const o of objects) {
			if (o == null) return;
			if (o.evaluateWhen !== evaluationType) return; // (sic) original returns early
			this.handleMapEvent(o, position);
		}
	}
	handleMapEvent(o, position) {
		if (!this.shouldHandleMapEvent(o)) return;
		switch (o.type) {
			case 'sign':
				if (o.id == null || o.id.length <= 0) return;
				this.worldEventListeners.emit('onPlayerSteppedOnMapSignArea', o);
				this.runScriptInArea(o);
				break;
			case 'newmap': {
				if (o.map == null || o.place == null) return;
				const ox = position.x - o.position.topLeft.x;
				const oy = position.y - o.position.topLeft.y;
				this.controllers.movementController.placePlayerAsyncAt('newmap', o.map, o.place, ox, oy);
				break;
			}
			case 'rest': this.steppedOnRestArea(o); break;
			case 'script': this.runScriptInArea(o); break;
		}
	}
	shouldHandleMapEvent(o) {
		if (!o.isActive) return false;
		if (this.world.model.uiSelections.isInCombat && o.type !== 'script') return false;
		return true;
	}
	runScriptInArea(o) {
		this.mapScriptExecutor.proceedToPhrase(o.id, true, true);
		this.applyCurrentMapReplacements(true);
	}
	steppedOnRestArea(area) {
		if (this.controllers.preferences.confirmRest) this.worldEventListeners.emit('onPlayerSteppedOnRestArea', area);
		else this.rest(area);
	}
	steppedOnMonster(m, p) {
		if (m.isAgressive(this.world.model.player)) {
			this.controllers.combatController.setCombatSelection(m, p);
			if (this.controllers.preferences.confirmAttack) this.worldEventListeners.emit('onPlayerSteppedOnMonster', m);
			else this.controllers.combatController.enterCombat(BeginTurnAs.player);
		} else {
			this.worldEventListeners.emit('onPlayerStartedConversation', m, m.getPhraseID());
		}
	}
	handlePlayerDeath() {
		this.controllers.combatController.exitCombat(false);
		const player = this.world.model.player;
		let lostExp = idiv(player.getCurrentLevelExperience() * Constants.PERCENT_EXP_LOST_WHEN_DIED, 100);
		lostExp -= idiv(lostExp * player.getSkillLevel('lowerExploss') * SC.PER_SKILLPOINT_INCREASE_EXPLOSS_PERCENT, 100);
		if (lostExp < 0) lostExp = 0;
		this.controllers.actorStatsController.addExperience(-lostExp);
		this.world.model.statistics.addPlayerDeath(lostExp);
		if (!this.world.model.statistics.isDead()) {
			this.lotsOfTimePassed();
			this.controllers.movementController.respawnPlayerAsync();
			this.mapScriptExecutor.proceedToPhrase(Constants.PASSIVE_ACHIEVEMENT_CHECK_PHRASE, true, true);
		}
		this.worldEventListeners.emit('onPlayerDied', lostExp);
	}
	lotsOfTimePassed() {
		const player = this.world.model.player;
		const asc = this.controllers.actorStatsController;
		asc.removeAllTemporaryConditions(player);
		asc.recalculatePlayerStats(player);
		asc.setActorMaxAP(player);
		asc.setActorMaxHealth(player);
		player.mapIconID = player.baseTraits.iconID;
		for (const m of this.world.maps.getAllMaps()) m.resetTemporaryData();
		this.world.model.worldData.tickWorldTime(20);
		this.controllers.gameRoundController.resetRoundTimers();
	}
	rest(area) {
		this.lotsOfTimePassed();
		this.controllers.monsterSpawnController.spawnAll(this.world.model.currentMaps.map, this.world.model.currentMaps.tileMap);
		this.mapScriptExecutor.proceedToPhrase(Constants.PASSIVE_ACHIEVEMENT_CHECK_PHRASE, true, true);
		this.world.model.player.setSpawnPlace(this.world.model.currentMaps.map.name, area.id);
		this.worldEventListeners.emit('onPlayerRested');
	}
	canEnterKeyArea(area) {
		if (area.enteringRequirement == null || ConversationController.canFulfillRequirement(this.world, area.enteringRequirement)) {
			if (area.enteringRequirement) ConversationController.requirementFulfilled(this.world, area.enteringRequirement, this.controllers);
			return true;
		}
		this.worldEventListeners.emit('onPlayerSteppedOnKeyArea', area);
		this.runScriptInArea(area);
		return false;
	}
	resetMapsNotRecentlyVisited() {
		for (const m of this.world.maps.getAllMaps()) {
			if (m === this.world.model.currentMaps.map) continue;
			if (m.isRecentlyVisited()) continue;
			if (m.hasResetTemporaryData()) continue;
			m.resetTemporaryData();
		}
	}
	applyCurrentMapReplacements(updateWorldmap) {
		const cm = this.world.model.currentMaps;
		if (!cm.tileMap) return;
		if (!this.applyReplacements(cm.map, cm.tileMap)) return;
		this.world.maps.worldMapRequiresUpdate = true;
		if (!updateWorldmap) return;
		this.mapLayoutListeners.emit('onMapTilesChanged', cm.map, cm.tileMap);
	}
	applyReplacements(map, tileMap) {
		let updated = false;
		if (tileMap.replacements != null) {
			for (const r of tileMap.replacements) {
				if (r.isApplied) continue;
				if (!this.satisfiesCondition(r)) continue;
				ConversationController.requirementFulfilled(this.world, r.requirement, this.controllers);
				tileMap.applyReplacement(r);
				for (const imp of tileMap.replacements) {
					if (r !== imp && imp.isApplied && imp.replacementArea.intersects(r.replacementArea)) imp.isApplied = false;
				}
				updated = true;
			}
		}
		if (map.currentColorFilter != null && map.currentColorFilter !== tileMap.colorFilter) {
			tileMap.changeColorFilter(map.currentColorFilter);
			updated = true;
		}
		if (map.lastSeenLayoutHash.toLowerCase() !== tileMap.getCurrentLayoutHash().toLowerCase()) {
			map.lastSeenLayoutHash = tileMap.getCurrentLayoutHash();
			updated = true;
		}
		return updated;
	}
	satisfiesCondition(r) { return ConversationController.canFulfillRequirement(this.world, r.requirement); }
	prepareScriptsOnCurrentMap() {
		this.mapScriptExecutor = new ConversationStatemachine(this.world, this.controllers, this.conversationStateListener);
	}
	activateMapObjectGroup(map, group) { if (map) map.activateMapObjectGroup(group); }
	deactivateMapObjectGroup(map, group) { if (map) map.deactivateMapObjectGroup(group); }
}
