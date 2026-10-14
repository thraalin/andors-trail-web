// Port of controller/ActorStatsController.java
import { ActorCondition, WearSlot, SC } from '../model.js';
import { Constants, rnd, ListOfListeners } from '../util.js';
import { SkillController } from './SkillController.js';
import { ItemController } from './ItemController.js';
import { MovementController } from './MovementController.js';

export const LevelUpSelection = { health: 'health', attackChance: 'attackChance', attackDamage: 'attackDamage', blockChance: 'blockChance' };

export class ActorStatsController {
	constructor(controllers, world) {
		this.controllers = controllers;
		this.world = world;
		this.actorConditionListeners = new ListOfListeners();
		this.actorStatsListeners = new ListOfListeners();
		this.playerStatsListeners = new ListOfListeners();
		this.combatActionListeners = new ListOfListeners();
	}

	*_wornEquipEffects(player) {
		for (const slot of WearSlot.values) {
			const t = player.inventory.getItemTypeInWearSlot(slot);
			if (t == null || t.effects_equip == null || t.effects_equip.addedConditions == null) continue;
			yield t.effects_equip.addedConditions;
		}
	}

	addConditionsFromEquippedItem(player, itemType) {
		const eq = itemType.effects_equip;
		if (eq == null || eq.addedConditions == null) return;
		for (const e of eq.addedConditions) this._applyActorCondition(player, e, ActorCondition.DURATION_FOREVER);
	}
	removeConditionsFromUnequippedItem(player, itemType) {
		const eq = itemType.effects_equip;
		if (eq == null || eq.addedConditions == null) return;
		for (const e of eq.addedConditions) {
			if (e.isImmunity()) this.removeActorConditionImmunity(player, e.conditionType, e.magnitude, ActorCondition.DURATION_FOREVER);
			if (e.isRemovalEffect()) continue;
			if (e.magnitude <= 0) continue;
			if (e.conditionType.isStacking) this.removeStackableActorCondition(player, e.conditionType, e.magnitude, ActorCondition.DURATION_FOREVER);
			else this.removeNonStackableActorCondition(player, e.conditionType, e.magnitude, ActorCondition.DURATION_FOREVER);
		}
	}
	removeStackableActorCondition(actor, type, magnitude, duration) {
		for (let i = actor.conditions.length - 1; i >= 0; --i) {
			const c = actor.conditions[i];
			if (type.conditionTypeID !== c.conditionType.conditionTypeID) continue;
			if (c.duration !== duration) continue;
			if (c.magnitude > magnitude) {
				c.magnitude -= magnitude;
				this.actorConditionListeners.emit('onActorConditionMagnitudeChanged', actor, c);
			} else {
				this.actorConditionsRemove(actor, c, i);
			}
			break;
		}
	}
	removeNonStackableActorCondition(player, type, magnitude, duration) {
		for (const conds of this._wornEquipEffects(player)) {
			for (const e of conds) {
				if (e.conditionType.conditionTypeID !== type.conditionTypeID) continue;
				if (e.duration !== duration) continue;
				return;
			}
		}
		this.removeStackableActorCondition(player, type, magnitude, duration);
	}
	removeActorConditionImmunity(player, type, magnitude, duration) {
		for (const conds of this._wornEquipEffects(player)) {
			for (const e of conds) {
				if (e.conditionType.conditionTypeID !== type.conditionTypeID) continue;
				if (!e.isImmunity()) continue;
				if (e.duration !== duration) continue;
				return;
			}
		}
		for (let i = player.immunities.length - 1; i >= 0; --i) {
			const c = player.immunities[i];
			if (type.conditionTypeID !== c.conditionType.conditionTypeID) continue;
			if (c.duration !== duration) continue;
			player.immunities.splice(i, 1);
			this.actorConditionListeners.emit('onActorConditionImmunityRemoved', player, c);
			break;
		}
		const toReapply = [];
		for (const conds of this._wornEquipEffects(player)) {
			for (const e of conds) {
				if (e.conditionType.conditionTypeID !== type.conditionTypeID) continue;
				if (e.isImmunity()) return;
				toReapply.push(e);
			}
		}
		for (const e of toReapply) this._applyActorCondition(player, e, ActorCondition.DURATION_FOREVER);
	}
	applyActorCondition(actor, e) { this._applyActorCondition(actor, e, e.duration); }
	_applyActorCondition(actor, e, duration) {
		if (e.isImmunity()) {
			this.removeAllConditionsOfType(actor, e.conditionType.conditionTypeID);
			this.addActorConditionImmunity(actor, e, duration);
		} else if (e.isRemovalEffect()) {
			this.removeAllConditionsOfType(actor, e.conditionType.conditionTypeID);
		} else if (e.magnitude > 0) {
			let immune = false;
			for (const im of actor.immunities) if (e.conditionType.conditionTypeID === im.conditionType.conditionTypeID) immune = true;
			if (!immune) {
				if (e.conditionType.isStacking) this.addStackableActorCondition(actor, e, duration);
				else this.addNonStackableActorCondition(actor, e, duration);
			}
		}
		this.recalculateActorCombatTraits(actor);
	}
	addStackableActorCondition(actor, e, duration) {
		const type = e.conditionType;
		for (let i = actor.conditions.length - 1; i >= 0; --i) {
			const c = actor.conditions[i];
			if (type.conditionTypeID !== c.conditionType.conditionTypeID) continue;
			if (c.duration === duration) {
				c.magnitude += e.magnitude;
				this.actorConditionListeners.emit('onActorConditionMagnitudeChanged', actor, c);
				return;
			}
		}
		const c = new ActorCondition(type, e.magnitude, duration);
		actor.conditions.push(c);
		this.actorConditionListeners.emit('onActorConditionAdded', actor, c);
	}
	addNonStackableActorCondition(actor, e, duration) {
		const type = e.conditionType;
		for (let i = actor.conditions.length - 1; i >= 0; --i) {
			const c = actor.conditions[i];
			if (type.conditionTypeID !== c.conditionType.conditionTypeID) continue;
			if (c.magnitude > e.magnitude) return;
			if (c.magnitude === e.magnitude && c.duration >= duration) return;
			actor.conditions.splice(i, 1);
			this.actorConditionListeners.emit('onActorConditionRemoved', actor, c);
		}
		const c = e.createCondition(duration);
		actor.conditions.push(c);
		this.actorConditionListeners.emit('onActorConditionAdded', actor, c);
	}
	addActorConditionImmunity(actor, e, duration) {
		const type = e.conditionType;
		for (let i = actor.immunities.length - 1; i >= 0; --i) {
			const c = actor.immunities[i];
			if (type.conditionTypeID !== c.conditionType.conditionTypeID) continue;
			if (c.duration >= duration) return;
			actor.immunities.splice(i, 1);
			this.actorConditionListeners.emit('onActorConditionRemoved', actor, c);
		}
		const c = e.createCondition(duration);
		actor.immunities.push(c);
		this.actorConditionListeners.emit('onActorConditionImmunityAdded', actor, c);
	}
	removeAllTemporaryConditions(actor) {
		for (let i = actor.conditions.length - 1; i >= 0; --i) {
			const c = actor.conditions[i];
			if (c.isTemporaryEffect() || c.isDurationForeverUntilSleep()) this.actorConditionsRemove(actor, c, i);
		}
	}
	removeAllConditionsOfType(actor, id) {
		for (let i = actor.conditions.length - 1; i >= 0; --i) {
			const c = actor.conditions[i];
			if (c.conditionType.conditionTypeID !== id) continue;
			this.actorConditionsRemove(actor, c, i);
		}
	}
	applyEffectsFromCurrentConditions(actor) {
		for (const c of actor.conditions) this.applyAbilityEffects(actor, c.conditionType.abilityEffect, c.magnitude);
	}
	applyAbilityEffects(actor, effects, multiplier) {
		if (effects == null) return;
		this.addActorMaxHealth(actor, effects.increaseMaxHP * multiplier, false);
		this.addActorMaxAP(actor, effects.increaseMaxAP * multiplier, false);
		this.addActorMoveCost(actor, effects.increaseMoveCost * multiplier);
		this.addActorAttackCost(actor, effects.increaseAttackCost * multiplier);
		if (actor.isPlayer) {
			this.addPlayerReequipCost(actor, effects.increaseReequipCost * multiplier);
			this.addPlayerUseCost(actor, effects.increaseUseItemCost * multiplier);
		}
		actor.attackChance += effects.increaseAttackChance * multiplier;
		actor.criticalSkill += effects.increaseCriticalSkill * multiplier;
		actor.damagePotential.add(effects.increaseMinDamage * multiplier, true);
		actor.damagePotential.addToMax(effects.increaseMaxDamage * multiplier);
		actor.blockChance += effects.increaseBlockChance * multiplier;
		actor.damageResistance += effects.increaseDamageResistance * multiplier;
	}
	recalculatePlayerStats(player) {
		player.weaponDamage.set(0, 0);
		player.resetStatsToBaseTraits();
		player.recalculateLevelExperience();
		this.controllers.itemController.applyInventoryEffects(player);
		this.controllers.skillController.applySkillEffects(player);
		this.applyEffectsFromCurrentConditions(player);
		ItemController.recalculateHitEffectsFromWornItems(player);
		ItemController.applyDamageModifier(player);
		this.capActorHealthAtMax(player);
		this.capActorAPAtMax(player);
		if (player.attackChance < 0) player.attackChance = 0;
		if (player.damagePotential.max < 0) player.damagePotential.set(0, 0);
	}
	recalculateMonsterCombatTraits(monster) {
		monster.resetStatsToBaseTraits();
		this.applyEffectsFromCurrentConditions(monster);
		this.capActorHealthAtMax(monster);
		this.capActorAPAtMax(monster);
		if (monster.attackChance < 0) monster.attackChance = 0;
		if (monster.damagePotential.max < 0) monster.damagePotential.set(0, 0);
	}
	recalculateActorCombatTraits(actor) {
		if (actor.isPlayer) this.recalculatePlayerStats(actor);
		else this.recalculateMonsterCombatTraits(actor);
	}
	applyConditionsToPlayer(player, isFullRound) {
		if (player.conditions.length === 0 && player.immunities.length === 0) return;
		if (!isFullRound) this.removeConditionsFromSkillEffects(player);
		this.applyStatsEffects(player, isFullRound);
		if (player.isDead()) {
			this.controllers.mapController.handlePlayerDeath();
			return;
		}
		if (!isFullRound) this.decreaseDurationAndRemoveConditions(player);
	}
	removeConditionsFromSkillEffects(player) {
		if (SkillController.rollForSkillChance(player, 'rejuvenation', SC.PER_SKILLPOINT_INCREASE_REJUVENATION_CHANCE)) {
			const i = ActorStatsController.getRandomConditionForRejuvenate(player);
			if (i >= 0) {
				const c = player.conditions[i];
				if (c.magnitude > 1) {
					c.magnitude -= 1;
					this.actorConditionListeners.emit('onActorConditionMagnitudeChanged', player, c);
				} else {
					player.conditions.splice(i, 1);
					this.actorConditionListeners.emit('onActorConditionRemoved', player, c);
				}
				this.recalculatePlayerStats(player);
			}
		}
	}
	static getRandomConditionForRejuvenate(player) {
		const pot = [];
		player.conditions.forEach((c, i) => {
			if (!c.isTemporaryEffect()) return;
			if (c.conditionType.isPositive) return;
			if (c.conditionType.conditionCategory === 'spiritual') return;
			pot.push(i);
		});
		if (pot.length === 0) return -1;
		return pot[rnd.nextInt(pot.length)];
	}
	applyConditionsToMonsters(map, isFullRound) {
		for (const a of map.spawnAreas) {
			for (let i = a.monsters.length - 1; i >= 0; --i) {
				const m = a.monsters[i];
				if (m) this.applyConditionsToMonster(m, isFullRound);
			}
		}
	}
	applyConditionsToMonster(monster, isFullRound) {
		if (monster.conditions.length === 0) return;
		this.applyStatsEffects(monster, isFullRound);
		if (monster.isDead()) {
			this.controllers.combatController.playerKilledMonster(monster);
			return;
		}
		if (!isFullRound) this.decreaseDurationAndRemoveConditions(monster);
	}
	applyStatsEffects(actor, isFullRound) {
		for (const c of [...actor.conditions]) if (!c.conditionType.isPositive) this._applyStatsEffectsC(actor, isFullRound, c);
		for (const c of [...actor.conditions]) if (c.conditionType.isPositive) this._applyStatsEffectsC(actor, isFullRound, c);
		this.controllers.effectController.startEnqueuedEffect(actor.position);
	}
	_applyStatsEffectsC(actor, isFullRound, c) {
		const effect = isFullRound ? c.conditionType.statsEffect_everyFullRound : c.conditionType.statsEffect_everyRound;
		const has = this.applyStatsModifierEffect(actor, effect, c.magnitude);
		if (has) this.actorConditionListeners.emit('onActorConditionRoundEffectApplied', actor, c);
	}
	decreaseDurationAndRemoveConditions(actor) {
		let removedAny = false;
		for (let i = actor.conditions.length - 1; i >= 0; --i) {
			const c = actor.conditions[i];
			if (!c.isTemporaryEffect()) continue;
			if (c.duration <= 1) {
				this.actorConditionsRemove(actor, c, i);
				removedAny = true;
			} else {
				c.duration -= 1;
				this.actorConditionListeners.emit('onActorConditionDurationChanged', actor, c);
			}
		}
		for (let i = actor.immunities.length - 1; i >= 0; --i) {
			const c = actor.immunities[i];
			if (!c.isTemporaryEffect()) continue;
			if (c.duration <= 1) {
				actor.immunities.splice(i, 1);
				this.actorConditionListeners.emit('onActorConditionImmunityRemoved', actor, c);
				removedAny = true;
			} else {
				c.duration -= 1;
				this.actorConditionListeners.emit('onActorConditionImmunityDurationChanged', actor, c);
			}
			if (actor.isPlayer) {
				let toReapply = [];
				outer: for (const conds of this._wornEquipEffects(actor)) {
					for (const e of conds) {
						if (e.conditionType.conditionTypeID !== c.conditionType.conditionTypeID) continue;
						if (e.isImmunity()) { toReapply = []; break; }
						toReapply.push(e);
					}
				}
				for (const e of toReapply) this._applyActorCondition(actor, e, ActorCondition.DURATION_FOREVER);
			}
		}
		if (removedAny) this.recalculateActorCombatTraits(actor);
	}
	actorConditionsRemove(actor, c, i) {
		let magnitude = 0;
		if (actor.isPlayer) {
			magnitude = this.gotConditionFromWornItem(actor, c);
			if (magnitude > 0) {
				c.magnitude = magnitude;
				this.actorConditionListeners.emit('onActorConditionMagnitudeChanged', actor, c);
				c.duration = ActorCondition.DURATION_FOREVER;
				this.actorConditionListeners.emit('onActorConditionDurationChanged', actor, c);
			}
		}
		if (magnitude === 0) {
			const idx = actor.conditions[i] === c ? i : actor.conditions.indexOf(c);
			if (idx >= 0) actor.conditions.splice(idx, 1);
			this.actorConditionListeners.emit('onActorConditionRemoved', actor, c);
		}
		return magnitude;
	}
	gotConditionFromWornItem(player, c) {
		let magnitude = 0;
		for (const conds of this._wornEquipEffects(player)) {
			for (const e of conds) {
				if (e.conditionType.conditionTypeID === c.conditionType.conditionTypeID) {
					if (e.magnitude === ActorCondition.MAGNITUDE_REMOVE_ALL) return 0;
					if (magnitude < e.magnitude) magnitude = e.magnitude;
				}
			}
		}
		return magnitude;
	}
	applyUseEffect(source, target, effect) {
		if (effect == null) return;
		if (effect.addedConditions_source != null) for (const e of effect.addedConditions_source) this.rollForConditionEffect(source, e);
		if (target != null && effect.addedConditions_target != null) for (const e of effect.addedConditions_target) this.rollForConditionEffect(target, e);
		if (effect.changedStats != null) {
			this.applyStatsModifierEffect(source, effect.changedStats, 1);
			this.controllers.effectController.startEnqueuedEffect(source.position);
		}
	}
	applyHitReceivedEffect(source, target, effect) {
		this.applyUseEffect(source, target, effect);
		if (effect.changedStats_target != null) {
			this.applyStatsModifierEffect(target, effect.changedStats, 1);
			this.controllers.effectController.startEnqueuedEffect(target.position);
		}
	}
	rollForConditionEffect(actor, ce) {
		if (!ce.conditionType) return;
		let bias = 0;
		if (actor.isPlayer) bias = SkillController.getActorConditionEffectChanceRollBias(ce, actor);
		if (!Constants.rollResult(ce.chance, bias)) return;
		if (actor.isPlayer) this.combatActionListeners.emit('onPlayerReceviesActorCondition', ce);
		else this.combatActionListeners.emit('onMonsterReceivesActorCondition', ce, actor);
		this.applyActorCondition(actor, ce);
	}
	applyStatsModifierEffect(actor, effect, magnitude) {
		if (effect == null) return false;
		let updated = false;
		if (effect.currentAPBoost != null) {
			const v = Constants.rollValue(effect.currentAPBoost) * magnitude;
			if (this.changeActorAP(actor, v, false, false)) {
				this.controllers.effectController.enqueueEffect(effect.visualEffectID || 'blueSwirl', v);
				updated = true;
			}
		}
		if (effect.currentHPBoost != null) {
			const v = Constants.rollValue(effect.currentHPBoost) * magnitude;
			if (this.changeActorHealth(actor, v, true, false)) {
				const vfx = effect.visualEffectID || (v > 0 ? 'blueSwirl' : 'redSplash');
				this.controllers.effectController.enqueueEffect(vfx, v);
				updated = true;
			}
		}
		return updated;
	}
	applyKillEffectsToPlayer(player) {
		for (const slot of WearSlot.values) {
			const t = player.inventory.getItemTypeInWearSlot(slot);
			if (t == null) continue;
			this.applyUseEffect(player, null, t.effects_kill);
		}
	}
	applyOnDeathEffectsToPlayer(player, monster) {
		const e = monster.getOnDeathEffects();
		if (e == null) return;
		this.applyUseEffect(player, null, e);
	}
	applySkillEffectsForNewRound(player, currentMap) {
		const level = player.getSkillLevel('regeneration');
		if (level > 0 && !MovementController.hasAdjacentAggressiveMonster(currentMap, player)) {
			this.addActorHealth(player, level * SC.PER_SKILLPOINT_INCREASE_REGENERATION);
		}
	}
	addPlayerWeaponDamage(player, minD, maxD) {
		player.weaponDamage.add(minD, true);
		player.weaponDamage.addToMax(maxD);
	}
	addLevelupEffect(player, selectionID) {
		let hp = 0;
		switch (selectionID) {
			case 'health': hp = Constants.LEVELUP_EFFECT_HEALTH; break;
			case 'attackChance': player.baseTraits.attackChance += Constants.LEVELUP_EFFECT_ATK_CH; break;
			case 'attackDamage':
				player.baseTraits.damagePotential.max += Constants.LEVELUP_EFFECT_ATK_DMG;
				player.baseTraits.damagePotential.current += Constants.LEVELUP_EFFECT_ATK_DMG;
				break;
			case 'blockChance': player.baseTraits.blockChance += Constants.LEVELUP_EFFECT_DEF_CH; break;
		}
		if (player.nextLevelAddsNewSkillpoint()) player.availableSkillIncreases++;
		player.level++;
		hp += player.getSkillLevel('fortitude') * SC.PER_SKILLPOINT_INCREASE_FORTITUDE_HEALTH;
		this.addActorMaxHealth(player, hp, true);
		player.baseTraits.maxHP += hp;
		this.recalculatePlayerStats(player);
	}
	healAllMonsters(area) {
		for (const m of area.monsters) { this.removeAllTemporaryConditions(m); this.setActorMaxHealth(m); }
	}
	addExperience(exp) {
		if (exp === 0) return;
		const p = this.world.model.player;
		p.totalExperience += exp;
		p.levelExperience.add(exp, true);
		this.playerStatsListeners.emit('onPlayerExperienceChanged', p);
	}
	addActorMoveCost(actor, amount) {
		if (amount === 0) return;
		actor.moveCost += amount;
		if (actor.moveCost <= 0) actor.moveCost = 1;
		this.actorStatsListeners.emit('onActorMoveCostChanged', actor, actor.moveCost);
	}
	addActorAttackCost(actor, amount) {
		if (amount === 0) return;
		actor.attackCost += amount;
		if (actor.attackCost <= 0) actor.attackCost = 1;
		this.actorStatsListeners.emit('onActorAttackCostChanged', actor, actor.attackCost);
	}
	addPlayerReequipCost(player, amount) {
		if (amount === 0) return;
		player.reequipCost += amount;
		if (player.reequipCost < 0) player.reequipCost = 0;
		this.actorStatsListeners.emit('onPlayerReequipCostChanged', player, player.reequipCost);
	}
	addPlayerUseCost(player, amount) {
		if (amount === 0) return;
		player.useItemCost += amount;
		if (player.useItemCost < 0) player.useItemCost = 0;
		this.actorStatsListeners.emit('onPlayerUseCostChanged', player, player.useItemCost);
	}
	setActorMaxHealth(actor) {
		if (actor.health.isMax()) return;
		actor.health.setMax();
		this.actorStatsListeners.emit('onActorHealthChanged', actor);
	}
	capActorHealthAtMax(actor) { if (actor.health.capAtMax()) this.actorStatsListeners.emit('onActorHealthChanged', actor); }
	addActorHealth(actor, amount) { return this.changeActorHealth(actor, amount, false, false); }
	removeActorHealth(actor, amount) { return this.changeActorHealth(actor, -amount, false, false); }
	changeActorHealth(actor, delta, mayUnderflow, mayOverflow) {
		const changed = actor.health.change(delta, mayUnderflow, mayOverflow);
		if (changed) this.actorStatsListeners.emit('onActorHealthChanged', actor);
		return changed;
	}
	addActorMaxHealth(actor, amount, affectCurrent) {
		if (amount === 0) return;
		actor.health.addToMax(amount);
		if (affectCurrent) actor.health.add(amount, false);
		this.actorStatsListeners.emit('onActorHealthChanged', actor);
	}
	setActorMaxAP(actor) {
		if (actor.ap.isMax()) return;
		actor.ap.setMax();
		this.actorStatsListeners.emit('onActorAPChanged', actor);
	}
	capActorAPAtMax(actor) { if (actor.ap.capAtMax()) this.actorStatsListeners.emit('onActorAPChanged', actor); }
	addActorAP(actor, amount) { return this.changeActorAP(actor, amount, false, false); }
	changeActorAP(actor, delta, mayUnderflow, mayOverflow) {
		const changed = actor.ap.change(delta, mayUnderflow, mayOverflow);
		if (changed) this.actorStatsListeners.emit('onActorAPChanged', actor);
		return changed;
	}
	useAPs(actor, cost) {
		if (actor.ap.current < cost) return false;
		actor.ap.subtract(cost, false);
		this.actorStatsListeners.emit('onActorAPChanged', actor);
		return true;
	}
	addActorMaxAP(actor, amount, affectCurrent) {
		if (amount === 0) return;
		actor.ap.addToMax(amount);
		if (affectCurrent) actor.ap.add(amount, false);
		this.actorStatsListeners.emit('onActorAPChanged', actor);
	}
	setActorMinAP(actor) {
		if (actor.ap.current === 0) return;
		actor.ap.current = 0;
		this.actorStatsListeners.emit('onActorAPChanged', actor);
	}
}
