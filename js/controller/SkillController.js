// Port of controller/SkillController.java
import { Constants, ListOfListeners, idiv } from '../util.js';
import { SC, ItemTypeCollection, Inventory, WearSlot, ActorConditionEffect } from '../model.js';
import { ItemController } from './ItemController.js';

// int overload: floor(v * pct / 100)
const pctI = (v, pos, neg) => (v === 0 ? 0 : v > 0 ? Math.floor(v * pos / 100) : Math.floor(v * neg / 100));
// float overload
const pctF = (v, pos, neg) => (v === 0 ? 0 : v > 0 ? v * pos / 100 : v * neg / 100);

export class SkillController {
	constructor(controllers, world) {
		this.controllers = controllers;
		this.world = world;
		this.combatActionListeners = new ListOfListeners();
	}
	applySkillEffects(player) {
		player.attackChance += SC.PER_SKILLPOINT_INCREASE_WEAPON_CHANCE * player.getSkillLevel('weaponChance');
		player.damagePotential.addToMax(SC.PER_SKILLPOINT_INCREASE_WEAPON_DAMAGE_MAX * player.getSkillLevel('weaponDmg'));
		player.damagePotential.add(SC.PER_SKILLPOINT_INCREASE_WEAPON_DAMAGE_MIN * player.getSkillLevel('weaponDmg'), false);
		player.blockChance += SC.PER_SKILLPOINT_INCREASE_DODGE * player.getSkillLevel('dodge');
		player.damageResistance += SC.PER_SKILLPOINT_INCREASE_BARKSKIN * player.getSkillLevel('barkSkin');
		if (player.hasCriticalSkillEffect() && player.criticalSkill > 0) {
			player.criticalSkill += idiv(player.criticalSkill * SC.PER_SKILLPOINT_INCREASE_MORE_CRITICALS_PERCENT * player.getSkillLevel('moreCriticals'), 100);
		}
		if (player.hasCriticalMultiplierEffect()) {
			player.criticalMultiplier += player.criticalMultiplier * SC.PER_SKILLPOINT_INCREASE_BETTER_CRITICALS_PERCENT * player.getSkillLevel('betterCriticals') / 100;
		}
		this.controllers.actorStatsController.addActorMaxAP(player, SC.PER_SKILLPOINT_INCREASE_SPEED * player.getSkillLevel('speed'), false);
	}
	static getDropChanceRollBias(item, itemType, player) {
		if (player == null) return 0;
		if (ItemTypeCollection.isGoldItemType(item.itemTypeID)) return SkillController.getRollBias(item.chance, player, 'coinfinder', SC.PER_SKILLPOINT_INCREASE_COINFINDER_CHANCE_PERCENT);
		if (itemType && !itemType.isOrdinaryItem()) return SkillController.getRollBias(item.chance, player, 'magicfinder', SC.PER_SKILLPOINT_INCREASE_MAGICFINDER_CHANCE_PERCENT);
		return 0;
	}
	static getDropQuantityRollBias(item, player) {
		if (player == null) return 0;
		if (!ItemTypeCollection.isGoldItemType(item.itemTypeID)) return 0;
		return SkillController.getRollBias(item.quantity, player, 'coinfinder', SC.PER_SKILLPOINT_INCREASE_COINFINDER_QUANTITY_PERCENT);
	}
	static getRollBias(chance, player, skill, per) {
		const lvl = player.getSkillLevel(skill);
		if (lvl <= 0) return 0;
		return chance.current * lvl * per;
	}
	static canLevelupSkillWithQuest(player, skill, levels) {
		const lvl = player.getSkillLevel(skill.id);
		if (skill.hasMaxLevel() && lvl + levels > skill.maxLevel) return false;
		return skill.canLevelUpSkillTo(player, lvl + levels);
	}
	static canLevelupSkillManually(player, skill) {
		if (!player.hasAvailableSkillpoints()) return false;
		if (!SkillController.canLevelupSkillWithQuest(player, skill, 1)) return false;
		if (skill.levelupVisibility === 'onlyByQuests') return false;
		if (skill.levelupVisibility === 'firstLevelRequiresQuest' && !player.hasSkill(skill.id)) return false;
		return true;
	}
	levelUpSkillManually(player, skill) {
		if (!SkillController.canLevelupSkillManually(player, skill)) return;
		player.availableSkillIncreases -= 1;
		this.addSkillLevel(skill.id);
	}
	levelUpSkillByQuest(player, skill) {
		if (!skill || !SkillController.canLevelupSkillWithQuest(player, skill, 1)) return false;
		this.addSkillLevel(skill.id);
		return true;
	}
	addSkillLevel(skillID) {
		const p = this.world.model.player;
		p.addSkillLevel(skillID);
		this.controllers.actorStatsController.recalculatePlayerStats(p);
	}
	static getActorConditionEffectChanceRollBias(effect, player) {
		if (effect.chance.isMax()) return 0;
		let r = 0;
		const cat = effect.conditionType.conditionCategory;
		const skill = cat === 'mental' ? 'resistanceMental' : cat === 'physical' ? 'resistancePhysical' : cat === 'blood' ? 'resistanceBlood' : null;
		if (skill) r += SkillController.getRollBias(effect.chance, player, skill, -SC.PER_SKILLPOINT_INCREASE_RESISTANCE_CHANCE_PERCENT);
		r += SkillController.getRollBias(effect.chance, player, 'shadowBless', -SC.PER_SKILLPOINT_INCREASE_RESISTANCE_SHADOW_BLESS);
		if (effect.conditionType.conditionTypeID === 'spore_poison') r += SkillController.getRollBias(effect.chance, player, 'sporeImmunity', -100);
		return r;
	}
	static rollForSkillChance(player, skill, chancePerLevel) {
		const lvl = player.getSkillLevel(skill);
		if (lvl <= 0) return false;
		return Constants.roll100(chancePerLevel * lvl);
	}
	addConditionToActor(target, name, magnitude, duration) {
		const t = this.world.actorConditionsTypes.getActorConditionType(name);
		if (!t) return;
		this.controllers.actorStatsController.applyActorCondition(target, new ActorConditionEffect(t, magnitude, duration, null));
	}
	applySkillEffectsFromPlayerAttack(result, monster) {
		if (!result.isHit) return;
		const player = this.world.model.player;
		if (player.getAttackChance() - monster.getBlockChance() > SC.CONCUSSION_THRESHOLD) {
			if (SkillController.rollForSkillChance(player, 'concussion', SC.PER_SKILLPOINT_INCREASE_CONCUSSION_CHANCE)) this.addConditionToActor(monster, 'concussion', 1, 5);
		}
		if (result.isCriticalHit) {
			if (SkillController.rollForSkillChance(player, 'crit2', SC.PER_SKILLPOINT_INCREASE_CRIT2_CHANCE)) this.addConditionToActor(monster, 'crit2', 1, 5);
			if (SkillController.rollForSkillChance(player, 'crit1', SC.PER_SKILLPOINT_INCREASE_CRIT1_CHANCE)) this.addConditionToActor(monster, 'crit1', 1, 5);
		}
	}
	applySkillEffectsFromMonsterAttack(result, monster) {
		if (!result.isHit && SkillController.rollForSkillChance(this.world.model.player, 'taunt', SC.PER_SKILLPOINT_INCREASE_TAUNT_CHANCE)) {
			this.combatActionListeners.emit('onPlayerTauntsMonster', monster);
			this.controllers.actorStatsController.changeActorAP(monster, -SC.TAUNT_AP_LOSS, false, false);
		}
	}
	static applySkillEffectsFromItemProficiencies(player) {
		const main = ItemController.getMainWeapon(player);
		if (main != null) {
			const lvl = SkillController.getSkillLevelForItemType(player, main);
			addPercentAttackChance(player, main, SC.PER_SKILLPOINT_INCREASE_WEAPON_PROF_AC_PERCENT * lvl, 0);
			addPercentBlockChance(player, main, SC.PER_SKILLPOINT_INCREASE_WEAPON_PROF_BC_PERCENT * lvl, 0);
			addPercentCriticalSkill(player, main, SC.PER_SKILLPOINT_INCREASE_WEAPON_PROF_CS_PERCENT * lvl, 0);
		}
		const unarmed = player.getSkillLevel('weaponProficiencyUnarmed');
		if (unarmed > 0 && SkillController.isUnarmed(player)) {
			player.attackChance += SC.PER_SKILLPOINT_INCREASE_UNARMED_AC * unarmed;
			player.damagePotential.addToMax(SC.PER_SKILLPOINT_INCREASE_UNARMED_DMG * unarmed);
			player.damagePotential.add(SC.PER_SKILLPOINT_INCREASE_UNARMED_DMG * unarmed, false);
			player.blockChance += SC.PER_SKILLPOINT_INCREASE_UNARMED_BC * unarmed;
		}
		const shield = player.inventory.getItemTypeInWearSlot('shield');
		if (shield != null && shield.isShield()) player.damageResistance += SC.PER_SKILLPOINT_INCREASE_SHIELD_PROF_DR * SkillController.getSkillLevelForItemType(player, shield);
		const unarmored = player.getSkillLevel('armorProficiencyUnarmored');
		if (unarmored > 0 && SkillController.isUnarmored(player)) player.blockChance += SC.PER_SKILLPOINT_INCREASE_UNARMORED_BC * unarmored;
		const light = player.getSkillLevel('armorProficiencyLight');
		const heavy = player.getSkillLevel('armorProficiencyHeavy');
		for (const slot of WearSlot.values) {
			if (!Inventory.isArmorSlot(slot)) continue;
			const t = player.inventory.getItemTypeInWearSlot(slot);
			if (t == null || t.effects_equip == null) continue;
			const skill = SkillController.getProficiencySkillForItemCategory(t.category);
			if (skill === 'armorProficiencyLight') {
				if (light > 0) addPercentBlockChance(player, t, SC.PER_SKILLPOINT_INCREASE_LIGHT_ARMOR_BC_PERCENT * light, 0);
			} else if (skill === 'armorProficiencyHeavy' && heavy > 0) {
				addPercentBlockChance(player, t, SC.PER_SKILLPOINT_INCREASE_HEAVY_ARMOR_BC_PERCENT * heavy, 0);
				const st = t.effects_equip.stats;
				if (st) {
					player.moveCost -= pctI(st.increaseMoveCost, SC.PER_SKILLPOINT_INCREASE_HEAVY_ARMOR_MOVECOST_PERCENT * heavy, 0);
					player.attackCost -= pctI(st.increaseAttackCost, SC.PER_SKILLPOINT_INCREASE_HEAVY_ARMOR_ATKCOST_PERCENT * heavy, 0);
					player.useItemCost -= pctI(st.increaseUseItemCost, SC.PER_SKILLPOINT_INCREASE_HEAVY_ARMOR_USECOST_PERCENT * heavy, 0);
				}
			}
		}
	}
	static isUnarmed(p) { return !SkillController.hasItemWithWeight(p, 'weapon') && !SkillController.hasItemWithWeight(p, 'shield'); }
	static isUnarmored(p) {
		for (const s of WearSlot.values) if (Inventory.isArmorSlot(s) && SkillController.hasItemWithWeight(p, s)) return false;
		return true;
	}
	static hasItemWithWeight(p, slot) {
		const t = p.inventory.getItemTypeInWearSlot(slot);
		if (t == null) return false;
		return t.category.getSize() !== 'none';
	}
	static getSkillLevelForItemType(p, t) {
		const s = SkillController.getProficiencySkillForItemCategory(t.category);
		return s == null ? 0 : p.getSkillLevel(s);
	}
	static getProficiencySkillForItemCategory(category) {
		const id = category.id;
		if (category.isWeapon()) {
			if (id === 'dagger' || id === 'ssword') return 'weaponProficiencyDagger';
			if (id === 'lsword' || id === 'bsword' || id === 'rapier') return 'weaponProficiency1hsword';
			if (id === '2hsword') return 'weaponProficiency2hsword';
			if (id === 'axe' || id === 'axe2h') return 'weaponProficiencyAxe';
			if (['club', 'staff', 'mace', 'scepter', 'hammer', 'hammer2h', 'whip'].includes(id)) return 'weaponProficiencyBlunt';
			if (id === 'pole') return 'weaponProficiencyPole';
		} else if (category.isShield()) {
			return 'armorProficiencyShield';
		} else if (category.isArmor()) {
			const s = category.getSize();
			if (s === 'light' || s === 'std') return 'armorProficiencyLight';
			if (s === 'large') return 'armorProficiencyHeavy';
		}
		return null;
	}
	static applySkillEffectsFromFightingStyles(player) {
		const main = player.inventory.getItemTypeInWearSlot('weapon');
		const off = player.inventory.getItemTypeInWearSlot('shield');
		const uu = player.getSkillLevel('fightstyleUnarmedUnarmored');
		if (uu > 0 && SkillController.isUnarmored(player) && main == null && off == null) {
			player.blockChance += SC.PER_SKILLPOINT_INCREASE_UNARMED_UNARMORED_BC * uu;
			player.damageResistance += SC.PER_SKILLPOINT_INCREASE_UNARMED_UNARMORED_DR * uu;
			player.attackChance += SC.PER_SKILLPOINT_INCREASE_UNARMED_UNARMORED_AC * uu;
			player.damagePotential.addToMax(SC.PER_SKILLPOINT_INCREASE_UNARMED_UNARMORED_DMG_MAX * uu);
			player.criticalMultiplier = 1 + (SC.PER_SKILLPOINT_INCREASE_UNARMED_UNARMORED_CM_PERCENT / 100) * uu;
		}
		if (SkillController.isWielding2HandItem(main, off)) {
			const fs = player.getSkillLevel('fightstyle2hand');
			const sp = player.getSkillLevel('specialization2hand');
			addPercentDamage(player, main, fs * SC.PER_SKILLPOINT_INCREASE_FIGHTSTYLE_2HAND_DMG_PERCENT, 0);
			addPercentDamage(player, main, sp * SC.PER_SKILLPOINT_INCREASE_SPECIALIZATION_2HAND_DMG_PERCENT, 0);
			addPercentAttackChance(player, main, sp * SC.PER_SKILLPOINT_INCREASE_SPECIALIZATION_2HAND_AC_PERCENT, 0);
		}
		if (SkillController.isWieldingWeaponAndShield(main, off)) {
			const fs = player.getSkillLevel('fightstyleWeaponShield');
			const sp = player.getSkillLevel('specializationWeaponShield');
			addPercentAttackChance(player, main, fs * SC.PER_SKILLPOINT_INCREASE_FIGHTSTYLE_WEAPON_AC_PERCENT, 0);
			addPercentBlockChance(player, off, fs * SC.PER_SKILLPOINT_INCREASE_FIGHTSTYLE_SHIELD_BC_PERCENT, 0);
			addPercentAttackChance(player, main, sp * SC.PER_SKILLPOINT_INCREASE_SPECIALIZATION_WEAPON_AC_PERCENT, 0);
			addPercentDamage(player, main, sp * SC.PER_SKILLPOINT_INCREASE_SPECIALIZATION_WEAPON_DMG_PERCENT, 0);
		}
		if (SkillController.isDualWielding(main, off)) {
			const fs = player.getSkillLevel('fightstyleDualWield');
			if (off.effects_equip != null && off.effects_equip.stats && main.effects_equip && main.effects_equip.stats) {
				const acMain = main.effects_equip.stats.increaseAttackCost;
				const acOff = off.effects_equip.stats.increaseAttackCost;
				const cmMain = main.effects_equip.stats.setCriticalMultiplier;
				const cmOff = off.effects_equip.stats.setCriticalMultiplier;
				let percent;
				if (fs === 2) {
					percent = SC.DUALWIELD_EFFICIENCY_LEVEL2;
					player.attackCost = Math.max(acMain, acOff);
					player.criticalMultiplier = Math.max(cmMain, pctF(cmOff, SC.DUALWIELD_EFFICIENCY_LEVEL2, 0));
				} else if (fs === 1) {
					percent = SC.DUALWIELD_EFFICIENCY_LEVEL1;
					player.attackCost = Math.max(acMain, acOff) + pctI(Math.min(acMain, acOff), SC.DUALWIELD_LEVEL1_OFFHAND_AP_COST_PERCENT, 0);
					player.criticalMultiplier = Math.max(cmMain, pctF(cmOff, SC.DUALWIELD_EFFICIENCY_LEVEL1, 0));
				} else {
					percent = SC.DUALWIELD_EFFICIENCY_LEVEL0;
					player.attackCost = acMain + acOff;
					player.criticalMultiplier = Math.max(cmMain, pctF(cmOff, SC.DUALWIELD_EFFICIENCY_LEVEL0, 0));
				}
				const lvl = SkillController.getSkillLevelForItemType(player, off);
				addPercentAttackChance(player, off, pctI(SC.PER_SKILLPOINT_INCREASE_WEAPON_PROF_AC_PERCENT * lvl, percent, 0), 0);
				addPercentBlockChance(player, off, pctI(SC.PER_SKILLPOINT_INCREASE_WEAPON_PROF_BC_PERCENT * lvl, percent, 0), 0);
				addPercentCriticalSkill(player, off, pctI(SC.PER_SKILLPOINT_INCREASE_WEAPON_PROF_CS_PERCENT * lvl, percent, 0), 0);
				addPercentAttackChance(player, off, percent, 100);
				addPercentBlockChance(player, off, percent, 100);
				addPercentDamage(player, off, percent, 100);
				addPercentCriticalSkill(player, off, percent, 100);
				addPercent(player, off, 'increaseMaxHP', percent, 100, (v) => player.health.addToMax(v));
				addPercent(player, off, 'increaseDamageResistance', percent, 100, (v) => { player.damageResistance += v; });
				addPercent(player, off, 'increaseMaxAP', percent, 100, (v) => player.ap.addToMax(v));
				addPercent(player, off, 'increaseMoveCost', 100, percent, (v) => { player.moveCost += v; });
				addPercent(player, off, 'increaseReequipCost', 100, percent, (v) => { player.reequipCost += v; });
				addPercent(player, off, 'increaseUseItemCost', 100, percent, (v) => { player.useItemCost += v; });
			}
			const sp = player.getSkillLevel('specializationDualWield');
			addPercentAttackChance(player, main, sp * SC.PER_SKILLPOINT_INCREASE_SPECIALIZATION_DUALWIELD_AC_PERCENT, 0);
			addPercentBlockChance(player, main, sp * SC.PER_SKILLPOINT_INCREASE_SPECIALIZATION_DUALWIELD_BC_PERCENT, 0);
			addPercentAttackChance(player, off, sp * SC.PER_SKILLPOINT_INCREASE_SPECIALIZATION_DUALWIELD_AC_PERCENT, 0);
			addPercentBlockChance(player, off, sp * SC.PER_SKILLPOINT_INCREASE_SPECIALIZATION_DUALWIELD_BC_PERCENT, 0);
		}
	}
	static isDualWielding(main, off) { return main != null && off != null && main.isWeapon() && off.isWeapon(); }
	static isWielding2HandItem(main, off) { return main != null && off == null && main.isTwohandWeapon(); }
	static isWieldingWeaponAndShield(main, off) { return main != null && off != null && main.isWeapon() && off.isShield(); }
}

function stats(t) { return t.effects_equip != null ? t.effects_equip.stats : null; }
function addPercent(player, t, field, pos, neg, apply) {
	const s = stats(t); if (!s) return;
	apply(pctI(s[field], pos, neg));
}
function addPercentAttackChance(player, t, pos, neg) { const s = stats(t); if (s) player.attackChance += pctI(s.increaseAttackChance, pos, neg); }
function addPercentBlockChance(player, t, pos, neg) { const s = stats(t); if (s) player.blockChance += pctI(s.increaseBlockChance, pos, neg); }
function addPercentCriticalSkill(player, t, pos, neg) { const s = stats(t); if (s) player.criticalSkill += pctI(s.increaseCriticalSkill, pos, neg); }
function addPercentDamage(player, t, pos, neg) {
	const s = stats(t); if (!s) return;
	player.damagePotential.addToMax(pctI(s.increaseMaxDamage, pos, neg));
	player.damagePotential.add(pctI(s.increaseMinDamage, pos, neg), false);
	if (t.isWeapon()) {
		player.weaponDamage.addToMax(pctI(s.increaseMaxDamage, pos, neg));
		player.weaponDamage.add(pctI(s.increaseMinDamage, pos, neg), false);
	}
}
