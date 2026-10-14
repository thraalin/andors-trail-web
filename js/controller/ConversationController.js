// Port of controller/ConversationController.java
import { ConstRange, Constants, Format } from '../util.js';
import { Loot, ActorCondition, ActorConditionEffect, QuestProgress, ItemTypeCollection, ConversationCollection, Phrase } from '../model.js';
import { MovementController } from './MovementController.js';
import { SkillController } from './SkillController.js';
import { TileManager } from '../resource/TileManager.js';
import { BeginTurnAs } from './CombatController.js';

const always = new ConstRange(1, 1);

export class ScriptEffectResult {
	constructor() {
		this.loot = new Loot();
		this.actorConditions = [];
		this.skillIncrease = [];
		this.questProgress = [];
	}
	isEmpty() {
		return !this.loot.hasItemsOrExp() && this.actorConditions.length === 0 && this.skillIncrease.length === 0 && this.questProgress.length === 0;
	}
}

export function localizeBracedNumbers(s) {
	if (s == null) return s;
	return s.replace(/\{\s*(-?\d*\.?\d+)\s*\}/g, (m, d) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 }).format(Number(d)));
}

export class ConversationController {
	constructor(controllers, world) {
		this.controllers = controllers;
		this.world = world;
	}
	applyScriptEffectsForPhrase(player, phrase) {
		if (phrase.scriptEffects == null || phrase.scriptEffects.length === 0) return null;
		const result = new ScriptEffectResult();
		for (const effect of phrase.scriptEffects) {
			let reqFalse = false;
			if (effect.hasRequirements()) {
				for (const r of effect.requires) {
					if (!ConversationController.canFulfillRequirement(this.world, r)) { reqFalse = true; break; }
				}
			}
			if (!reqFalse) this.applyScriptEffect(player, effect, result);
		}
		if (result.isEmpty()) return null;
		player.inventory.add(result.loot);
		this.controllers.actorStatsController.addExperience(result.loot.exp);
		return result;
	}
	applyScriptEffect(player, effect, result) {
		const C = Constants;
		switch (effect.type) {
			case 'actorCondition': this.addActorConditionReward(player, effect.effectID, effect.value, result); break;
			case 'actorConditionImmunity': this.addActorConditionImmunityReward(player, effect.effectID, effect.value, result); break;
			case 'skillIncrease': this.addSkillReward(player, effect.effectID, result); break;
			case 'dropList': this.addDropListReward(player, effect.effectID, result); break;
			case 'questProgress': this.addQuestProgressReward(player, effect.effectID, effect.value, result); break;
			case 'alignmentChange': player.addAlignment(effect.effectID, effect.value); this.refreshAggr(); break;
			case 'alignmentSet': player.setAlignment(effect.effectID, effect.value); this.refreshAggr(); break;
			case 'alignmentToReg1': player.setAlignment(C.FACTION_SCORE_CALC_REGISTER1_NAME, player.getAlignment(effect.effectID)); break;
			case 'alignmentToReg2': player.setAlignment(C.FACTION_SCORE_CALC_REGISTER2_NAME, player.getAlignment(effect.effectID)); break;
			case 'alignmentToReg3': player.setAlignment(C.FACTION_SCORE_CALC_REGISTER3_NAME, player.getAlignment(effect.effectID)); break;
			case 'setNextPhraseID': this.world.model.worldData.nextPhraseID = effect.effectID; break;
			case 'alignmentFromReg1': player.setAlignment(effect.effectID, player.getAlignment(C.FACTION_SCORE_CALC_REGISTER1_NAME)); this.refreshAggr(); break;
			// NB: original only handles alignmentFromReg1 (Reg2/Reg3 fall through and do nothing)
			case 'alignmentAdd': player.addAlignment(C.FACTION_SCORE_CALC_REGISTER1_NAME, player.getAlignment(effect.effectID)); break;
			case 'alignmentSub': player.addAlignment(C.FACTION_SCORE_CALC_REGISTER1_NAME, -1 * player.getAlignment(effect.effectID)); break;
			case 'alignmentDiv': {
				let mult = effect.value === 0 ? 1 : effect.value;
				const i1 = player.getAlignment(C.FACTION_SCORE_CALC_REGISTER1_NAME) * mult;
				const i2 = player.getAlignment(effect.effectID);
				if (i2 !== 0) player.setAlignment(C.FACTION_SCORE_CALC_REGISTER1_NAME, Math.trunc(i1 / i2));
				break;
			}
			case 'alignmentMult': {
				let mult = effect.value;
				if (mult === 0) mult = player.getAlignment(C.FACTION_SCORE_CALC_REGISTER1_NAME);
				player.setAlignment(C.FACTION_SCORE_CALC_REGISTER1_NAME, player.getAlignment(effect.effectID) * mult);
				break;
			}
			case 'giveItem': this.addItemReward(effect.effectID, effect.value, result); break;
			case 'createTimer': this.world.model.worldData.createTimer(effect.effectID); break;
			case 'spawnAll': this.spawnAll(effect.mapName, effect.effectID); break;
			case 'removeSpawnArea': this.deactivateSpawnArea(effect.mapName, effect.effectID, true); break;
			case 'deactivateSpawnArea': this.deactivateSpawnArea(effect.mapName, effect.effectID, false); break;
			case 'activateMapObjectGroup': this.controllers.mapController.activateMapObjectGroup(this.findMapForScriptEffect(effect.mapName), effect.effectID); break;
			case 'deactivateMapObjectGroup': this.controllers.mapController.deactivateMapObjectGroup(this.findMapForScriptEffect(effect.mapName), effect.effectID); break;
			case 'removeQuestProgress': player.removeQuestProgress(new QuestProgress(effect.effectID, effect.value)); break;
			case 'changeMapFilter': {
				const map = this.findMapForScriptEffect(effect.mapName);
				map.currentColorFilter = effect.effectID;
				if (this.world.model.currentMaps.map === map) this.controllers.mapController.applyCurrentMapReplacements(true);
				break;
			}
			case 'mapchange': this.controllers.movementController.placePlayerAsyncAt('newmap', effect.mapName, effect.effectID, 0, 0); break;
			case 'changeIcon': this.changeIcon(player, effect.value); break;
		}
	}
	refreshAggr() { MovementController.refreshMonsterAggressiveness(this.world.model.currentMaps.map, this.world.model.player); }
	findMapForScriptEffect(mapName) {
		if (mapName == null) return this.world.model.currentMaps.map;
		return this.world.maps.findPredefinedMap(mapName);
	}
	spawnAll(mapName, areaId) {
		const map = this.findMapForScriptEffect(mapName);
		if (!map) return;
		const tileMap = map === this.world.model.currentMaps.map ? this.world.model.currentMaps.tileMap : null;
		for (const area of map.spawnAreas) {
			if (area.areaID !== areaId) continue;
			this.controllers.monsterSpawnController.activateSpawnArea(map, tileMap, area, true);
			this.controllers.effectController.asyncUpdateArea(area.area);
		}
	}
	deactivateSpawnArea(mapName, areaID, removeAll) {
		const map = this.findMapForScriptEffect(mapName);
		if (!map) return;
		for (const area of map.spawnAreas) {
			if (area.areaID !== areaID) continue;
			this.controllers.monsterSpawnController.deactivateSpawnArea(area, removeAll);
			if (removeAll) this.controllers.effectController.asyncUpdateArea(area.area);
		}
	}
	changeIcon(player, heroNr) {
		switch (heroNr) {
			case 0: player.replaceIcon(TileManager.CHAR_HERO_0); break;
			case 1: player.replaceIcon(TileManager.CHAR_HERO_1); break;
			case 2: player.replaceIcon(TileManager.CHAR_HERO_2); break;
			case 10: player.replaceIcon(TileManager.CHAR_HERO_SHIP); break;
			case 11: player.replaceIcon(TileManager.CHAR_HERO_SHEEP); break;
			case 999: player.replaceIcon(player.iconID); break;
		}
	}
	addQuestProgressReward(player, questID, qp, result) {
		const progress = new QuestProgress(questID, qp);
		if (!player.addQuestProgress(progress)) return;
		const stage = this.world.quests.getQuestLogEntry(progress);
		if (stage == null) return;
		result.loot.exp += stage.rewardExperience;
		result.questProgress.push(progress);
	}
	addDropListReward(player, id, result) {
		const dl = this.world.dropLists.getDropList(id);
		if (dl) dl.createRandomLoot(result.loot, player);
	}
	addItemReward(itemTypeID, quantity, result) {
		if (ItemTypeCollection.isItemFilter(itemTypeID)) {
			const f = this.world.itemFilters.getItemFilter(itemTypeID);
			if (f) result.loot.add(f.getRandomItem(), quantity);
		} else {
			const t = this.world.itemTypes.getItemType(itemTypeID);
			if (t) result.loot.add(t, quantity);
		}
	}
	addSkillReward(player, skillID, result) {
		const skill = this.world.skills.getSkill(skillID);
		if (this.controllers.skillController.levelUpSkillByQuest(player, skill)) result.skillIncrease.push(skill);
	}
	addActorConditionReward(player, id, value, result) {
		let magnitude = 1, duration = value;
		if (value === ActorCondition.DURATION_FOREVER) duration = ActorCondition.DURATION_FOREVER;
		else if (value === ActorCondition.MAGNITUDE_REMOVE_ALL) { duration = ActorCondition.DURATION_NONE; magnitude = ActorCondition.MAGNITUDE_REMOVE_ALL; }
		const t = this.world.actorConditionsTypes.getActorConditionType(id);
		if (!t) return;
		const e = new ActorConditionEffect(t, magnitude, duration, always);
		this.controllers.actorStatsController.applyActorCondition(player, e);
		result.actorConditions.push(e);
	}
	addActorConditionImmunityReward(player, id, value, result) {
		const t = this.world.actorConditionsTypes.getActorConditionType(id);
		if (!t) return;
		const e = new ActorConditionEffect(t, ActorCondition.MAGNITUDE_REMOVE_ALL, value, always);
		this.controllers.actorStatsController.applyActorCondition(player, e);
		result.actorConditions.push(e);
	}
	static applyReplyEffect(world, reply, controllers) {
		if (!reply.hasRequirements()) return;
		for (const r of reply.requires) ConversationController.requirementFulfilled(world, r, controllers);
	}
	static canSelectReply(world, reply) {
		if (!reply.hasRequirements()) return true;
		for (const r of reply.requires) if (!ConversationController.canFulfillRequirement(world, r)) return false;
		return true;
	}
	static canFulfillRequirement(world, req) {
		const player = world.model.player;
		const stats = world.model.statistics;
		const filterAny = (pred) => {
			const f = world.itemFilters.getItemFilter(req.requireID);
			if (f == null) return false;
			for (const it of f.getItemTypes()) if (it && pred(it)) return true;
			return false;
		};
		let result;
		switch (req.requireType) {
			case 'questProgress': result = player.hasExactQuestProgress(req.requireID, req.value); break;
			case 'questLatestProgress': result = player.isLatestQuestProgress(req.requireID, req.value); break;
			case 'wear': case 'wearRemove':
				if (ItemTypeCollection.isItemFilter(req.requireID)) result = filterAny((it) => player.inventory.isWearing(it.id, req.value));
				else result = player.inventory.isWearing(req.requireID, req.value);
				break;
			case 'inventoryKeep': case 'inventoryRemove':
				if (ItemTypeCollection.isGoldItemType(req.requireID)) result = player.inventory.gold >= req.value;
				else if (ItemTypeCollection.isItemFilter(req.requireID)) result = filterAny((it) => player.inventory.hasItem(it.id, req.value));
				else result = player.inventory.hasItem(req.requireID, req.value);
				break;
			case 'skillLevel': result = player.getSkillLevel(req.requireID) >= req.value; break;
			case 'killedMonster': result = stats.getNumberOfKillsForMonsterType(req.requireID) >= req.value; break;
			case 'timerElapsed': result = world.model.worldData.hasTimerElapsed(req.requireID, req.value); break;
			case 'usedItem':
				if (ItemTypeCollection.isItemFilter(req.requireID)) result = filterAny((it) => stats.getNumberOfTimesItemHasBeenUsed(it.id) >= req.value);
				else result = stats.getNumberOfTimesItemHasBeenUsed(req.requireID) >= req.value;
				break;
			case 'spentGold': result = stats.getSpentGold() >= req.value; break;
			case 'random': result = Constants.rollResult(req.chance); break;
			case 'consumedBonemeals': result = stats.getNumberOfUsedBonemealPotions() >= req.value; break;
			case 'hasActorCondition': result = player.hasCondition(req.requireID); break;
			case 'factionScore': result = player.getAlignment(req.requireID) >= req.value; break;
			case 'factionScoreEquals': result = player.getAlignment(req.requireID) === req.value; break;
			case 'date': result = world.model.worldData.getDate(req.requireID) >= req.value; break;
			case 'dateEquals': result = world.model.worldData.getDate(req.requireID) === req.value; break;
			case 'time': result = world.model.worldData.getTime(req.requireID) >= req.value; break;
			case 'timeEquals': result = world.model.worldData.getTime(req.requireID) === req.value; break;
			case 'skillIncrease': {
				const levels = req.value <= 0 ? 1 : req.value;
				const skill = world.skills.getSkill(req.requireID);
				result = skill ? SkillController.canLevelupSkillWithQuest(player, skill, levels) : false;
				break;
			}
			default: result = true;
		}
		return req.negate ? !result : result;
	}
	static requirementFulfilled(world, req, controllers) {
		const p = world.model.player;
		switch (req.requireType) {
			case 'inventoryRemove':
				if (ItemTypeCollection.isGoldItemType(req.requireID)) {
					p.inventory.gold -= req.value;
					world.model.statistics.addGoldSpent(req.value);
				} else if (ItemTypeCollection.isItemFilter(req.requireID)) {
					const f = world.itemFilters.getItemFilter(req.requireID);
					if (f) for (const it of f.getItemTypes()) {
						if (it && p.inventory.hasItem(it.id, req.value)) { p.inventory.removeItem(it.id, req.value); break; }
					}
				} else {
					p.inventory.removeItem(req.requireID, req.value);
				}
				break;
			case 'wearRemove':
				if (ItemTypeCollection.isItemFilter(req.requireID)) {
					const f = world.itemFilters.getItemFilter(req.requireID);
					if (f) for (const it of f.getItemTypes()) {
						if (it && p.inventory.isWearing(it.id, req.value)) { controllers.itemController.removeEquippedItem(it.id, req.value); break; }
					}
				} else {
					controllers.itemController.removeEquippedItem(req.requireID, req.value);
				}
				break;
		}
	}
	static replacePlayerName(s, player) {
		const C = Constants;
		return s.split(C.PLACEHOLDER_PLAYERNAME).join(player.getName())
			.split(C.PLACEHOLDER_REG1).join(Format.localizeInt(player.getAlignment(C.FACTION_SCORE_CALC_REGISTER1_NAME)))
			.split(C.PLACEHOLDER_REG2).join(Format.localizeInt(player.getAlignment(C.FACTION_SCORE_CALC_REGISTER2_NAME)))
			.split(C.PLACEHOLDER_REG3).join(Format.localizeInt(player.getAlignment(C.FACTION_SCORE_CALC_REGISTER3_NAME)));
	}
	static getDisplayMessage(text, player) { return localizeBracedNumbers(ConversationController.replacePlayerName(text, player)); }
	static getNextPhraseID(world, reply) {
		return reply.nextPhrase.split(Constants.PLACEHOLDER_NEXTPHRASEID).join(String(world.model.worldData.nextPhraseID));
	}
}

// Drives a conversation; listener receives UI callbacks.
export class ConversationStatemachine {
	constructor(world, controllers, listener) {
		this.world = world;
		this.player = world.model.player;
		this.controllers = controllers;
		this.listener = listener;
		this.currentPhraseID = null;
		this.currentPhrase = null;
		this.npc = null;
	}
	setCurrentNPC(npc) { this.npc = npc; }
	getCurrentNPC() { return this.npc; }
	getCurrentPhraseID() { return this.currentPhraseID; }
	playerSelectedReply(r) {
		ConversationController.applyReplyEffect(this.world, r, this.controllers);
		this.proceedToPhrase(ConversationController.getNextPhraseID(this.world, r), true, true);
	}
	playerSelectedNextStep() { this.playerSelectedReply(this.currentPhrase.replies[0]); }
	setCurrentPhrase(phraseID) {
		this.currentPhraseID = phraseID;
		this.currentPhrase = this.world.conversationLoader.loadPhrase(phraseID);
		if (this.currentPhrase == null) this.currentPhrase = new Phrase('(phrase "' + phraseID + '" not implemented yet)', null, null, null);
		if (this.currentPhrase.switchToNPC != null) {
			this.setCurrentNPC(this.world.model.currentMaps.map.findSpawnedMonster(this.currentPhrase.switchToNPC));
		}
	}
	proceedToPhrase(phraseID, applyScriptEffects, displayPhraseMessage) {
		let guard = 0;
		while (phraseID != null && guard++ < 1000) phraseID = this.proceedToPhraseInternal(phraseID, applyScriptEffects, displayPhraseMessage);
	}
	proceedToPhraseInternal(phraseID, applyScriptEffects, displayPhraseMessage) {
		const id = phraseID.toUpperCase();
		if (id === ConversationCollection.PHRASE_CLOSE) { this.listener.onConversationEnded(); return null; }
		if (id === ConversationCollection.PHRASE_SHOP) { this.listener.onConversationEndedWithShop(this.npc); return null; }
		if (id === ConversationCollection.PHRASE_ATTACK) { this.endConversationWithCombat(); return null; }
		if (id === ConversationCollection.PHRASE_REMOVE) { this.endConversationWithRemovingNPC(); return null; }
		this.setCurrentPhrase(phraseID);
		if (applyScriptEffects) {
			const r = this.controllers.conversationController.applyScriptEffectsForPhrase(this.player, this.currentPhrase);
			if (r != null) this.listener.onScriptEffectsApplied(r);
		}
		if (this.currentPhrase.message == null) {
			for (const r of this.currentPhrase.replies) {
				if (!ConversationController.canSelectReply(this.world, r)) continue;
				ConversationController.applyReplyEffect(this.world, r, this.controllers);
				return ConversationController.getNextPhraseID(this.world, r);
			}
		} else if (displayPhraseMessage) {
			this.listener.onTextPhraseReached(ConversationController.getDisplayMessage(this.currentPhrase.message, this.player), this.npc, phraseID);
		}
		if (this.hasOnlyOneNextReply()) { this.listener.onConversationCanProceedWithNext(); return null; }
		for (const r of this.currentPhrase.replies) {
			if (!ConversationController.canSelectReply(this.world, r)) continue;
			this.listener.onConversationHasReply(r, ConversationController.getDisplayMessage(r.text, this.player));
		}
		return null;
	}
	endConversationWithRemovingNPC() {
		if (this.npc == null) { this.listener.onConversationEnded(); return; }
		this.controllers.monsterSpawnController.remove(this.world.model.currentMaps.map, this.npc);
		this.listener.onConversationEndedWithRemoval(this.npc);
	}
	endConversationWithCombat() {
		if (this.npc == null) { this.listener.onConversationEnded(); return; }
		this.npc.forceAggressive();
		this.controllers.combatController.setCombatSelection(this.npc);
		this.controllers.combatController.enterCombat(BeginTurnAs.player);
		this.listener.onConversationEndedWithCombat(this.npc);
	}
	hasOnlyOneNextReply() {
		const r = this.currentPhrase.replies;
		if (r == null || r.length !== 1) return false;
		if (r[0].text !== ConversationCollection.REPLY_NEXT) return false;
		return ConversationController.canSelectReply(this.world, r[0]);
	}
}
