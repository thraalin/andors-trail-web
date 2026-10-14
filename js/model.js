// Port of com.gpl.rpg.AndorsTrail.model.*
import { Coord, CoordRect, Size, Range, ConstRange, Constants, rnd, idiv, toInt, makeEnum, L } from './util.js';
import { SkillController } from './controller/SkillController.js';
import { TileManager } from './resource/TileManager.js';

// ---------------------------------------------------------------- ability
export class ActorCondition {
	static MAGNITUDE_REMOVE_ALL = -99;
	static DURATION_FOREVER = 999;
	static DURATION_FOREVER_UNTIL_SLEEP = 998;
	static DURATION_NONE = 0;
	constructor(conditionType, magnitude, duration) {
		this.conditionType = conditionType;
		this.magnitude = magnitude;
		this.duration = duration;
	}
	isTemporaryEffect() { return ActorCondition.isTemporaryEffect(this.duration); }
	static isTemporaryEffect(duration) {
		return duration !== ActorCondition.DURATION_FOREVER && duration !== ActorCondition.DURATION_FOREVER_UNTIL_SLEEP;
	}
	isDurationForeverUntilSleep() { return ActorCondition.isDurationForeverUntilSleep(this.duration); }
	static isDurationForeverUntilSleep(duration) { return duration === ActorCondition.DURATION_FOREVER_UNTIL_SLEEP; }
	toJSON() { return [this.conditionType.conditionTypeID, this.magnitude, this.duration]; }
	static fromJSON(a, world) {
		const t = world.actorConditionsTypes.getActorConditionType(a[0]);
		if (!t) return null;
		return new ActorCondition(t, a[1], a[2]);
	}
}

export class ActorConditionEffect {
	constructor(conditionType, magnitude, duration, chance) {
		this.conditionType = conditionType;
		this.magnitude = magnitude;
		this.duration = duration;
		this.chance = chance;
	}
	isImmunity() { return this.magnitude === ActorCondition.MAGNITUDE_REMOVE_ALL && this.duration !== ActorCondition.DURATION_NONE; }
	isRemovalEffect() { return this.magnitude === ActorCondition.MAGNITUDE_REMOVE_ALL && this.duration === ActorCondition.DURATION_NONE; }
	createCondition(duration = this.duration) { return new ActorCondition(this.conditionType, this.magnitude, duration); }
}

export const ConditionCategory = makeEnum('spiritual', 'mental', 'physical', 'blood');

export class ActorConditionType {
	constructor(conditionTypeID, name, description, iconID, conditionCategory, isStacking, isPositive,
		statsEffect_everyRound, statsEffect_everyFullRound, abilityEffect) {
		Object.assign(this, { conditionTypeID, name, description, iconID, conditionCategory, isStacking, isPositive,
			statsEffect_everyRound, statsEffect_everyFullRound, abilityEffect });
	}
}

export class ActorConditionTypeCollection {
	constructor() { this.conditionTypes = new Map(); }
	getActorConditionType(id) { return this.conditionTypes.get(id); }
	initialize(parser, input) { parser.parseRows(input, this.conditionTypes); }
}

export const SkillID = makeEnum(
	'weaponChance', 'weaponDmg', 'barter', 'dodge', 'barkSkin', 'moreCriticals', 'betterCriticals', 'speed',
	'coinfinder', 'moreExp', 'cleave', 'eater', 'fortitude', 'evasion', 'regeneration', 'lowerExploss',
	'magicfinder', 'resistanceMental', 'resistancePhysical', 'resistanceBlood', 'shadowBless', 'crit1', 'crit2',
	'rejuvenation', 'taunt', 'concussion', 'weaponProficiencyDagger', 'weaponProficiency1hsword',
	'weaponProficiency2hsword', 'weaponProficiencyAxe', 'weaponProficiencyBlunt', 'weaponProficiencyUnarmed',
	'armorProficiencyShield', 'armorProficiencyUnarmored', 'armorProficiencyLight', 'armorProficiencyHeavy',
	'fightstyleDualWield', 'fightstyle2hand', 'fightstyleWeaponShield', 'specializationDualWield',
	'specialization2hand', 'specializationWeaponShield', 'weaponProficiencyPole', 'fightstyleUnarmedUnarmored',
	'sporeImmunity');

export const SkillCategory = makeEnum('all', 'offense', 'defense', 'criticals', 'immunity', 'utility', 'specialty', 'proficiency');

export const LevelUpType = makeEnum('alwaysShown', 'onlyByQuests', 'firstLevelRequiresQuest');

export class SkillLevelRequirement {
	static RequirementType = makeEnum('skillLevel', 'experienceLevel', 'playerStat');
	constructor(requirementType, everySkillLevelRequiresThisAmount, initialRequiredAmount, skillOrStatID) {
		Object.assign(this, { requirementType, everySkillLevelRequiresThisAmount, initialRequiredAmount, skillOrStatID });
	}
	static requireOtherSkill(skillID, every) { return new SkillLevelRequirement('skillLevel', every, 0, skillID); }
	static requireExperienceLevels(every, initial) { return new SkillLevelRequirement('experienceLevel', every, initial, null); }
	static requirePlayerStats(statID, every, initial) { return new SkillLevelRequirement('playerStat', every, initial, statID); }
	isSatisfiedByPlayer(player, requestedSkillLevel) {
		return this.getRequirementActualValue(player) >= this.getRequiredValue(requestedSkillLevel);
	}
	getRequiredValue(requestedSkillLevel) {
		return requestedSkillLevel * this.everySkillLevelRequiresThisAmount + this.initialRequiredAmount;
	}
	getRequirementActualValue(player) {
		switch (this.requirementType) {
			case 'skillLevel': return player.getSkillLevel(this.skillOrStatID);
			case 'experienceLevel': return player.getLevel();
			case 'playerStat': return player.getStatValue(this.skillOrStatID);
			default: return 0;
		}
	}
}

export class SkillInfo {
	static MAXLEVEL_NONE = -1;
	constructor(id, maxLevel, levelupVisibility, categoryType, levelupRequirements, position) {
		Object.assign(this, { id, maxLevel, levelupVisibility, categoryType, levelupRequirements, position });
	}
	hasMaxLevel() { return this.maxLevel !== SkillInfo.MAXLEVEL_NONE; }
	hasLevelupRequirements() { return this.levelupRequirements != null; }
	canLevelUpSkillTo(player, requestedSkillLevel) {
		if (!this.hasLevelupRequirements()) return true;
		for (const r of this.levelupRequirements) {
			if (!r.isSatisfiedByPlayer(player, requestedSkillLevel)) return false;
		}
		return true;
	}
}

export const SC = {
	PER_SKILLPOINT_INCREASE_WEAPON_CHANCE: 12,
	PER_SKILLPOINT_INCREASE_WEAPON_DAMAGE_MAX: 2,
	PER_SKILLPOINT_INCREASE_WEAPON_DAMAGE_MIN: 0,
	PER_SKILLPOINT_INCREASE_DODGE: 9,
	PER_SKILLPOINT_INCREASE_BARKSKIN: 1,
	PER_SKILLPOINT_INCREASE_MORE_CRITICALS_PERCENT: 20,
	PER_SKILLPOINT_INCREASE_BETTER_CRITICALS_PERCENT: 25,
	PER_SKILLPOINT_INCREASE_SPEED: 1,
	PER_SKILLPOINT_INCREASE_BARTER_PRICEFACTOR_PERCENTAGE: 4,
	PER_SKILLPOINT_INCREASE_COINFINDER_CHANCE_PERCENT: 30,
	PER_SKILLPOINT_INCREASE_MAGICFINDER_CHANCE_PERCENT: 50,
	PER_SKILLPOINT_INCREASE_COINFINDER_QUANTITY_PERCENT: 50,
	PER_SKILLPOINT_INCREASE_MORE_EXP_PERCENT: 10,
	PER_SKILLPOINT_INCREASE_CLEAVE_AP: 3,
	PER_SKILLPOINT_INCREASE_EATER_HEALTH: 1,
	PER_SKILLPOINT_INCREASE_FORTITUDE_HEALTH: 1,
	PER_SKILLPOINT_INCREASE_EVASION_FLEE_CHANCE_PERCENTAGE: 5,
	PER_SKILLPOINT_INCREASE_EVASION_MONSTER_ATTACK_CHANCE_PERCENTAGE: 5,
	PER_SKILLPOINT_INCREASE_REGENERATION: 1,
	PER_SKILLPOINT_INCREASE_EXPLOSS_PERCENT: 20,
	PER_SKILLPOINT_INCREASE_RESISTANCE_CHANCE_PERCENT: 10,
	PER_SKILLPOINT_INCREASE_RESISTANCE_SHADOW_BLESS: 5,
	PER_SKILLPOINT_INCREASE_CRIT1_CHANCE: 50,
	PER_SKILLPOINT_INCREASE_CRIT2_CHANCE: 50,
	PER_SKILLPOINT_INCREASE_REJUVENATION_CHANCE: 20,
	PER_SKILLPOINT_INCREASE_TAUNT_CHANCE: 75,
	TAUNT_AP_LOSS: 2,
	CONCUSSION_THRESHOLD: 50,
	PER_SKILLPOINT_INCREASE_CONCUSSION_CHANCE: 15,
	PER_SKILLPOINT_INCREASE_WEAPON_PROF_AC_PERCENT: 30,
	PER_SKILLPOINT_INCREASE_WEAPON_PROF_CS_PERCENT: 10,
	PER_SKILLPOINT_INCREASE_WEAPON_PROF_BC_PERCENT: 30,
	PER_SKILLPOINT_INCREASE_UNARMED_AC: 20,
	PER_SKILLPOINT_INCREASE_UNARMED_DMG: 2,
	PER_SKILLPOINT_INCREASE_UNARMED_BC: 5,
	PER_SKILLPOINT_INCREASE_SHIELD_PROF_DR: 1,
	PER_SKILLPOINT_INCREASE_UNARMORED_BC: 10,
	PER_SKILLPOINT_INCREASE_LIGHT_ARMOR_BC_PERCENT: 30,
	PER_SKILLPOINT_INCREASE_HEAVY_ARMOR_BC_PERCENT: 20,
	PER_SKILLPOINT_INCREASE_HEAVY_ARMOR_MOVECOST_PERCENT: 25,
	PER_SKILLPOINT_INCREASE_HEAVY_ARMOR_ATKCOST_PERCENT: 25,
	PER_SKILLPOINT_INCREASE_HEAVY_ARMOR_USECOST_PERCENT: 25,
	PER_SKILLPOINT_INCREASE_FIGHTSTYLE_2HAND_DMG_PERCENT: 30,
	PER_SKILLPOINT_INCREASE_SPECIALIZATION_2HAND_DMG_PERCENT: 50,
	PER_SKILLPOINT_INCREASE_SPECIALIZATION_2HAND_AC_PERCENT: 20,
	PER_SKILLPOINT_INCREASE_FIGHTSTYLE_WEAPON_AC_PERCENT: 25,
	PER_SKILLPOINT_INCREASE_FIGHTSTYLE_SHIELD_BC_PERCENT: 25,
	PER_SKILLPOINT_INCREASE_UNARMED_UNARMORED_BC: 5,
	PER_SKILLPOINT_INCREASE_UNARMED_UNARMORED_DR: 1,
	PER_SKILLPOINT_INCREASE_UNARMED_UNARMORED_AC: 12,
	PER_SKILLPOINT_INCREASE_UNARMED_UNARMORED_DMG_MAX: 4,
	PER_SKILLPOINT_INCREASE_UNARMED_UNARMORED_CM_PERCENT: 25,
	PER_SKILLPOINT_INCREASE_SPECIALIZATION_WEAPON_AC_PERCENT: 50,
	PER_SKILLPOINT_INCREASE_SPECIALIZATION_WEAPON_DMG_PERCENT: 20,
	DUALWIELD_EFFICIENCY_LEVEL2: 100,
	DUALWIELD_EFFICIENCY_LEVEL1: 50,
	DUALWIELD_EFFICIENCY_LEVEL0: 25,
	DUALWIELD_LEVEL1_OFFHAND_AP_COST_PERCENT: 50,
	PER_SKILLPOINT_INCREASE_SPECIALIZATION_DUALWIELD_AC_PERCENT: 50,
	PER_SKILLPOINT_INCREASE_SPECIALIZATION_DUALWIELD_BC_PERCENT: 50,
};
SC.MAX_LEVEL_BARTER = Math.floor(Constants.MARKET_PRICEFACTOR_PERCENT / SC.PER_SKILLPOINT_INCREASE_BARTER_PRICEFACTOR_PERCENTAGE);
SC.MAX_LEVEL_BARKSKIN = 5;
SC.MAX_LEVEL_SPEED = 2;
SC.MAX_LEVEL_EVASION = Math.max(
	idiv(Constants.FLEE_FAIL_CHANCE_PERCENT, SC.PER_SKILLPOINT_INCREASE_EVASION_FLEE_CHANCE_PERCENTAGE),
	idiv(Constants.MONSTER_AGGRESSION_CHANCE_PERCENT, SC.PER_SKILLPOINT_INCREASE_EVASION_MONSTER_ATTACK_CHANCE_PERCENTAGE));
SC.MAX_LEVEL_LOWER_EXPLOSS = idiv(100, SC.PER_SKILLPOINT_INCREASE_EXPLOSS_PERCENT);
SC.MAX_LEVEL_RESISTANCE = idiv(70, SC.PER_SKILLPOINT_INCREASE_RESISTANCE_CHANCE_PERCENT);

export class SkillCollection {
	constructor() { this.skills = new Map(); }
	initialize() {
		const R = SkillLevelRequirement;
		const N = SkillInfo.MAXLEVEL_NONE;
		let position = 0;
		const add = (id, max, vis, cat, reqs) => this.skills.set(id, new SkillInfo(id, max, vis, cat, reqs, position++));
		add('weaponChance', N, 'alwaysShown', 'offense', null);
		add('weaponDmg', N, 'alwaysShown', 'offense', null);
		add('barter', SC.MAX_LEVEL_BARTER, 'alwaysShown', 'utility', null);
		add('dodge', N, 'alwaysShown', 'defense', null);
		add('barkSkin', SC.MAX_LEVEL_BARKSKIN, 'alwaysShown', 'defense', [R.requireExperienceLevels(10, 0), R.requirePlayerStats('blockChance', 15, 0)]);
		add('moreCriticals', N, 'alwaysShown', 'criticals', null);
		add('betterCriticals', N, 'alwaysShown', 'criticals', [R.requireOtherSkill('moreCriticals', 1)]);
		add('speed', SC.MAX_LEVEL_SPEED, 'alwaysShown', 'offense', [R.requireExperienceLevels(15, 0)]);
		add('coinfinder', N, 'alwaysShown', 'utility', null);
		add('moreExp', N, 'alwaysShown', 'utility', null);
		add('cleave', N, 'alwaysShown', 'offense', [R.requireOtherSkill('weaponChance', 1), R.requireOtherSkill('weaponDmg', 1)]);
		add('eater', N, 'alwaysShown', 'immunity', [R.requirePlayerStats('maxHP', 20, 20)]);
		add('fortitude', N, 'alwaysShown', 'immunity', [R.requireExperienceLevels(15, -10)]);
		add('evasion', SC.MAX_LEVEL_EVASION, 'alwaysShown', 'defense', null);
		add('regeneration', N, 'alwaysShown', 'immunity', [R.requirePlayerStats('maxHP', 30, 0), R.requireOtherSkill('fortitude', 1)]);
		add('lowerExploss', SC.MAX_LEVEL_LOWER_EXPLOSS, 'alwaysShown', 'utility', null);
		add('magicfinder', N, 'alwaysShown', 'utility', null);
		add('resistanceMental', SC.MAX_LEVEL_RESISTANCE, 'alwaysShown', 'immunity', null);
		add('resistancePhysical', SC.MAX_LEVEL_RESISTANCE, 'alwaysShown', 'immunity', null);
		add('resistanceBlood', SC.MAX_LEVEL_RESISTANCE, 'alwaysShown', 'immunity', null);
		add('shadowBless', 1, 'onlyByQuests', 'immunity', null);
		add('crit1', 1, 'alwaysShown', 'criticals', [R.requireOtherSkill('moreCriticals', 2), R.requireOtherSkill('betterCriticals', 2)]);
		add('crit2', 1, 'alwaysShown', 'criticals', [R.requireOtherSkill('moreCriticals', 4), R.requireOtherSkill('betterCriticals', 4), R.requireOtherSkill('crit1', 1)]);
		add('rejuvenation', 1, 'alwaysShown', 'immunity', [R.requireOtherSkill('resistanceBlood', 3), R.requireOtherSkill('resistanceMental', 3), R.requireOtherSkill('resistancePhysical', 3)]);
		add('taunt', 1, 'alwaysShown', 'defense', [R.requireOtherSkill('evasion', 2), R.requireOtherSkill('dodge', 4)]);
		add('concussion', 1, 'alwaysShown', 'offense', [R.requireOtherSkill('speed', 2), R.requireOtherSkill('weaponChance', 3), R.requireOtherSkill('weaponDmg', 5)]);
		add('weaponProficiencyDagger', 3, 'firstLevelRequiresQuest', 'proficiency', null);
		add('weaponProficiency1hsword', 3, 'firstLevelRequiresQuest', 'proficiency', null);
		add('weaponProficiency2hsword', 3, 'firstLevelRequiresQuest', 'proficiency', null);
		add('weaponProficiencyAxe', 3, 'firstLevelRequiresQuest', 'proficiency', null);
		add('weaponProficiencyBlunt', 3, 'firstLevelRequiresQuest', 'proficiency', null);
		add('weaponProficiencyUnarmed', 3, 'firstLevelRequiresQuest', 'proficiency', null);
		add('weaponProficiencyPole', 3, 'firstLevelRequiresQuest', 'proficiency', null);
		add('armorProficiencyShield', 2, 'firstLevelRequiresQuest', 'proficiency', null);
		add('armorProficiencyUnarmored', 3, 'firstLevelRequiresQuest', 'proficiency', null);
		add('armorProficiencyLight', 3, 'firstLevelRequiresQuest', 'proficiency', null);
		add('armorProficiencyHeavy', 4, 'firstLevelRequiresQuest', 'proficiency', null);
		add('fightstyleDualWield', 2, 'alwaysShown', 'specialty', [R.requireExperienceLevels(15, 0)]);
		add('fightstyle2hand', 2, 'alwaysShown', 'specialty', [R.requireExperienceLevels(15, 0)]);
		add('fightstyleWeaponShield', 2, 'alwaysShown', 'specialty', [R.requireExperienceLevels(15, 0)]);
		add('fightstyleUnarmedUnarmored', 3, 'alwaysShown', 'specialty', [R.requireExperienceLevels(15, 0)]);
		add('specializationDualWield', 1, 'alwaysShown', 'specialty', [R.requireExperienceLevels(45, 0), R.requireOtherSkill('fightstyleDualWield', 2)]);
		add('specialization2hand', 1, 'alwaysShown', 'specialty', [R.requireExperienceLevels(45, 0), R.requireOtherSkill('fightstyle2hand', 2)]);
		add('specializationWeaponShield', 1, 'alwaysShown', 'specialty', [R.requireExperienceLevels(45, 0), R.requireOtherSkill('fightstyleWeaponShield', 2)]);
		add('sporeImmunity', 1, 'onlyByQuests', 'immunity', null);
	}
	getSkill(skillID) { return this.skills.get(skillID); }
	getAllSkills() { return [...this.skills.values()].sort((a, b) => a.position - b.position); }
}

export class AbilityModifierTraits {
	constructor(increaseMaxHP, increaseMaxAP, increaseMoveCost, increaseUseItemCost, increaseReequipCost,
		increaseAttackCost, increaseAttackChance, increaseBlockChance, increaseMinDamage, increaseMaxDamage,
		setNonWeaponDamageModifier, increaseCriticalSkill, setCriticalMultiplier, increaseDamageResistance) {
		Object.assign(this, { increaseMaxHP, increaseMaxAP, increaseMoveCost, increaseUseItemCost, increaseReequipCost,
			increaseAttackCost, increaseAttackChance, increaseBlockChance, increaseMinDamage, increaseMaxDamage,
			setNonWeaponDamageModifier, increaseCriticalSkill, setCriticalMultiplier, increaseDamageResistance });
	}
}

export class StatsModifierTraits {
	constructor(visualEffectID, currentHPBoost, currentAPBoost) {
		this.visualEffectID = visualEffectID;
		this.currentHPBoost = currentHPBoost;
		this.currentAPBoost = currentAPBoost;
	}
	calculateUseCost() {
		const avgHP = this.currentHPBoost == null ? 0 : this.currentHPBoost.averagef();
		if (avgHP === 0) return 0;
		return jint(0.1 * Math.sign(avgHP) * Math.pow(Math.abs(avgHP), 2) + 3 * avgHP);
	}
	calculateHitCost() {
		const avgHP = this.currentHPBoost == null ? 0 : this.currentHPBoost.averagef();
		const avgAP = this.currentAPBoost == null ? 0 : this.currentAPBoost.averagef();
		if (avgHP === 0 && avgAP === 0) return 0;
		const a = jint(2770 * Math.pow(Math.max(0, avgHP), 2.5) + 450 * avgHP);
		const b = jint(3100 * Math.pow(Math.max(0, avgAP), 2.5) + 300 * avgAP);
		return (a + b) | 0;
	}
	calculateKillCost() {
		const avgHP = this.currentHPBoost == null ? 0 : this.currentHPBoost.averagef();
		const avgAP = this.currentAPBoost == null ? 0 : this.currentAPBoost.averagef();
		if (avgHP === 0 && avgAP === 0) return 0;
		const a = jint(923 * Math.pow(Math.max(0, avgHP), 2.5) + 450 * avgHP);
		const b = jint(1033 * Math.pow(Math.max(0, avgAP), 2.5) + 300 * avgAP);
		return (a + b) | 0;
	}
}
// Java (int) cast of double: NaN->0, saturates at int range
export function jint(d) {
	if (Number.isNaN(d)) return 0;
	if (d >= 2147483647) return 2147483647;
	if (d <= -2147483648) return -2147483648;
	return Math.trunc(d);
}
// Patch AbilityModifierTraits to use saturating cast
AbilityModifierTraits.prototype.calculateCost = function (isWeapon) {
	const P = Math.pow, max = Math.max, min = Math.min, abs = Math.abs;
	const costBC = jint(3 * P(max(0, this.increaseBlockChance), 2.5) + 28 * this.increaseBlockChance);
	const costAC = jint(0.4 * P(max(0, this.increaseAttackChance), 2.5) - 6 * P(abs(min(0, this.increaseAttackChance)), 2.7));
	const costAP = isWeapon
		? jint(0.2 * P(10.0 / this.increaseAttackCost, 8) - 25 * this.increaseAttackCost)
		: -3125 * this.increaseAttackCost;
	const costDR = 1325 * this.increaseDamageResistance;
	const costDMG_Min = isWeapon
		? jint(10 * P(max(0, this.increaseMinDamage), 2.5))
		: jint(10 * P(max(0, this.increaseMinDamage), 3) + this.increaseMinDamage * 80);
	const costDMG_Max = isWeapon
		? jint(2 * P(max(0, this.increaseMaxDamage), 2.1))
		: jint(2 * P(max(0, this.increaseMaxDamage), 3) + this.increaseMaxDamage * 20);
	const costCS = jint(2.2 * P(this.increaseCriticalSkill, 3));
	const costCM = jint(50 * P(max(0, this.setCriticalMultiplier), 2));
	const costMaxHP = jint(30 * P(max(0, this.increaseMaxHP), 1.2) + 70 * this.increaseMaxHP);
	const costMaxAP = jint(50 * P(max(0, this.increaseMaxAP), 3) + 750 * this.increaseMaxAP);
	const costMovement = jint(510 * P(max(0, -this.increaseMoveCost), 2.5) - 350 * this.increaseMoveCost);
	const costUseItem = jint(915 * P(max(0, -this.increaseUseItemCost), 3) - 430 * this.increaseUseItemCost);
	const costReequip = jint(450 * P(max(0, -this.increaseReequipCost), 2) - 250 * this.increaseReequipCost);
	let sum = 0;
	for (const v of [costBC, costAC, costAP, costDR, costDMG_Min, costDMG_Max, costCS, costCM, costMaxHP, costMaxAP, costMovement, costUseItem, costReequip]) sum = (sum + v) | 0;
	return sum;
};

// ---------------------------------------------------------------- item traits
export class ItemTraits_OnUse {
	constructor(changedStats, addedConditions_source, addedConditions_target) {
		this.changedStats = changedStats;
		this.addedConditions_source = addedConditions_source;
		this.addedConditions_target = addedConditions_target;
	}
	calculateUseCost() { return this.changedStats == null ? 0 : this.changedStats.calculateUseCost(); }
	calculateHitCost() { return this.changedStats == null ? 0 : this.changedStats.calculateHitCost(); }
	calculateKillCost() { return this.changedStats == null ? 0 : this.changedStats.calculateKillCost(); }
}
export class ItemTraits_OnHitReceived extends ItemTraits_OnUse {
	constructor(changedStats, changedStats_target, addedConditions_source, addedConditions_target) {
		// NB: matches original (passes changedStats_target as changedStats to super)
		super(changedStats_target, addedConditions_source, addedConditions_target);
		this.changedStats_target = changedStats_target;
		this._changedStatsSource = changedStats;
	}
	calculateHitReceivedCost() {
		let c = this.changedStats == null ? 0 : this.changedStats.calculateHitCost();
		c += this.changedStats_target == null ? 0 : -this.changedStats_target.calculateHitCost();
		return c;
	}
}
export class ItemTraits_OnEquip {
	constructor(stats, addedConditions) { this.stats = stats; this.addedConditions = addedConditions; }
	calculateEquipCost(isWeapon) { return this.stats == null ? 0 : this.stats.calculateCost(isWeapon); }
}

// ---------------------------------------------------------------- items
export const WearSlot = makeEnum('weapon', 'shield', 'head', 'body', 'hand', 'feet', 'neck', 'leftring', 'rightring');
export const ItemCategorySize = makeEnum('none', 'light', 'std', 'large');
export const ActionType = makeEnum('none', 'use', 'equip');
export const DisplayType = makeEnum('ordinary', 'quest', 'rare', 'extraordinary', 'legendary');

export class ItemCategory {
	constructor(id, displayName, actionType, inventorySlot, size) {
		Object.assign(this, { id, displayName, actionType, inventorySlot, size });
	}
	getSize() { return this.size; }
	isEquippable() { return this.actionType === 'equip'; }
	isUsable() { return this.actionType === 'use'; }
	isWeapon() { return this.inventorySlot === 'weapon'; }
	isShield() { return this.inventorySlot === 'shield'; }
	isArmor() { return Inventory.isArmorSlot(this.inventorySlot); }
	isTwohandWeapon() { return this.isWeapon() && this.size === 'large'; }
	isOffhandCapableWeapon() { return this.isWeapon() && (this.size === 'light' || this.size === 'std'); }
}
export class ItemCategoryCollection {
	constructor() { this.itemCategories = new Map(); }
	getItemCategory(id) { return this.itemCategories.get(id); }
	initialize(parser, input) { parser.parseRows(input, this.itemCategories); }
}

export class ItemType {
	constructor(id, iconID, name, description, category, displayType, hasManualPrice, fixedBaseMarketCost,
		effects_equip, effects_use, effects_hit, effects_miss, effects_kill, effects_hitReceived, effects_missReceived) {
		this.id = id;
		this.iconID = iconID;
		this.name = name;
		this.description = description;
		this.category = category;
		this.displayType = displayType;
		this.hasManualPrice = hasManualPrice;
		this.baseMarketCost = hasManualPrice ? fixedBaseMarketCost : ItemType.calculateCost(category, effects_equip, effects_use, effects_hit, effects_kill);
		this.fixedBaseMarketCost = fixedBaseMarketCost;
		this.effects_equip = effects_equip;
		this.effects_use = effects_use;
		this.effects_hit = effects_hit;
		this.effects_miss = effects_miss;
		this.effects_kill = effects_kill;
		this.effects_hitReceived = effects_hitReceived;
		this.effects_missReceived = effects_missReceived;
		this.hasPersonalizedName = name.includes(Constants.PLACEHOLDER_PLAYERNAME);
	}
	isEquippable() { return this.category.isEquippable(); }
	isUsable() { return this.category.isUsable(); }
	isQuestItem() { return this.displayType === 'quest'; }
	isOrdinaryItem() { return this.displayType === 'ordinary'; }
	isWeapon() { return this.category.isWeapon(); }
	isArmor() { return this.category.isArmor(); }
	isShield() { return this.category.isShield(); }
	isTwohandWeapon() { return this.category.isTwohandWeapon(); }
	isOffhandCapableWeapon() { return this.category.isOffhandCapableWeapon(); }
	isSellable() { return !this.isQuestItem() && this.baseMarketCost !== 0; }
	getDescription() { return this.description; }
	getName(p) {
		if (!this.hasPersonalizedName) return this.name;
		return this.name.split(Constants.PLACEHOLDER_PLAYERNAME).join(p ? p.getName() : '');
	}
	getOverlayTileID() {
		switch (this.displayType) {
			case 'quest': return TileManager.iconID_selection_yellow;
			case 'legendary': return TileManager.iconID_selection_green;
			case 'extraordinary': return TileManager.iconID_selection_blue;
			case 'rare': return TileManager.iconID_selection_purple;
			default: return -1;
		}
	}
	static calculateCost(category, eq, use, hit, kill) {
		const a = eq == null ? 0 : eq.calculateEquipCost(category.isWeapon());
		const b = use == null ? 0 : use.calculateUseCost();
		const c = hit == null ? 0 : hit.calculateHitCost();
		const d = kill == null ? 0 : kill.calculateKillCost();
		return Math.max(1, (a + b + c + d) | 0);
	}
}

export class ItemTypeCollection {
	static ITEMTYPE_GOLD = 'gold';
	constructor() { this.itemTypes = new Map(); }
	getItemType(id) { return this.itemTypes.get(id) || null; }
	static isGoldItemType(id) { return id != null && id === ItemTypeCollection.ITEMTYPE_GOLD; }
	static isItemFilter(id) { return id != null && id.toLowerCase().startsWith(Constants.ITEMFILTER_ID_PREFIX); }
	static getItemFilterID(id) {
		return ItemTypeCollection.isItemFilter(id) ? id.substring(Constants.ITEMFILTER_ID_PREFIX.length) : id;
	}
	initialize(parser, input) { parser.parseRows(input, this.itemTypes); }
}

export class ItemFilter {
	constructor(id, include) { this.id = id; this.include = include; }
	getItemTypes() { return (this.include == null || this.include.length === 0) ? [] : this.include; }
	getRandomItem() {
		const all = this.getItemTypes();
		return all[Constants.rollValue(new Range(all.length - 1, 0))];
	}
}
export class ItemFilterCollection {
	constructor() { this.itemFilters = new Map(); }
	getItemFilter(id) { return this.itemFilters.get(ItemTypeCollection.getItemFilterID(id)) || null; }
	initialize(parser, input) { parser.parseRows(input, this.itemFilters); }
}

export class ItemEntry {
	constructor(itemType, quantity) { this.itemType = itemType; this.quantity = quantity; }
	getQuantity() { return this.quantity; }
}

export class ItemContainer {
	constructor() { this.items = []; }
	countItems() { let r = 0; for (const i of this.items) r += i.quantity; return r; }
	addItem(itemType, quantity = 1) {
		if (quantity === 0) return;
		const e = this.findItem(itemType.id);
		if (e != null) e.quantity += quantity;
		else this.items.push(new ItemEntry(itemType, quantity));
	}
	add(container) { for (const e of container.items) this.addItem(e.itemType, e.quantity); }
	isEmpty() { return this.items.length === 0; }
	removeItem(itemTypeID, quantity = 1) {
		const index = this.findItemIndex(itemTypeID);
		if (index < 0) return false;
		const e = this.items[index];
		if (e.quantity === quantity) this.items.splice(index, 1);
		else if (e.quantity > quantity) e.quantity -= quantity;
		else return false;
		return true;
	}
	findItem(id) { for (const e of this.items) if (e.itemType.id === id) return e; return null; }
	findItemIndex(id) { for (let i = 0; i < this.items.length; ++i) if (this.items[i].itemType.id === id) return i; return -1; }
	hasItem(id, minimumQuantity) {
		if (minimumQuantity === undefined) return this.findItem(id) != null;
		return this.getItemQuantity(id) >= minimumQuantity;
	}
	getItemQuantity(id) { const e = this.findItem(id); return e == null ? 0 : e.quantity; }
	sortToTop(id) { const i = this.findItemIndex(id); if (i <= 0) return; this.items.unshift(this.items.splice(i, 1)[0]); }
	sortToBottom(id) { const i = this.findItemIndex(id); if (i < 0) return; this.items.push(this.items.splice(i, 1)[0]); }
	usableItems() {
		const c = new ItemContainer();
		for (const it of this.items) if (it.itemType.isUsable()) c.addItem(it.itemType, it.quantity);
		return c;
	}
	sortByName(p) { this.items.sort((a, b) => cmpStr(a.itemType.getName(p), b.itemType.getName(p))); }
	sortByPrice(p) {
		this.items.sort((a, b) => (b.itemType.baseMarketCost - a.itemType.baseMarketCost) || cmpStr(a.itemType.getName(p), b.itemType.getName(p)));
	}
	sortByQuantity(p) { this.items.sort((a, b) => (b.quantity - a.quantity) || cmpStr(a.itemType.getName(p), b.itemType.getName(p))); }
	sortByRarity(p) {
		this.items.sort((a, b) => (DisplayType.ordinal(b.itemType.displayType) - DisplayType.ordinal(a.itemType.displayType)) || cmpStr(a.itemType.getName(p), b.itemType.getName(p)));
	}
	sortByType(p) { this.items.sort((a, b) => (this.determineType(a) - this.determineType(b)) || cmpStr(a.itemType.getName(p), b.itemType.getName(p))); }
	determineType(item) {
		const t = item.itemType;
		if (t.isEquippable()) {
			switch (t.category.inventorySlot) {
				case 'weapon': return t.isTwohandWeapon() ? 100 : 110;
				case 'shield': return 200;
				case 'head': return 210;
				case 'body': return 220;
				case 'hand': return 230;
				case 'feet': return 240;
				case 'neck': return 250;
				case 'leftring': case 'rightring': return 260;
				default: return 270;
			}
		} else if (t.isUsable()) {
			return (t.category.id === 'pot' || t.category.id === 'healing') ? 300 : 310;
		} else if (t.isQuestItem()) return 400;
		return 500;
	}
	sortByReverse() { this.items.reverse(); }
	toJSON() { return this.items.map((e) => [e.itemType.id, e.quantity]); }
	readJSON(a, world) {
		this.items.length = 0;
		for (const [id, q] of a || []) {
			const t = world.itemTypes.getItemType(id);
			if (t) this.items.push(new ItemEntry(t, q));
		}
		return this;
	}
	static fromJSON(a, world) { return new ItemContainer().readJSON(a, world); }
}
function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

export class Inventory extends ItemContainer {
	static NUM_WORN_SLOTS = WearSlot.values.length;
	static NUM_QUICK_SLOTS = 3;
	constructor() {
		super();
		this.gold = 0;
		this.wear = new Array(Inventory.NUM_WORN_SLOTS).fill(null);
		this.quickitem = new Array(Inventory.NUM_QUICK_SLOTS).fill(null);
	}
	clear() {
		this.wear.fill(null);
		this.quickitem.fill(null);
		this.gold = 0;
		this.items.length = 0;
	}
	add(x) {
		if (x instanceof Loot) { this.gold += x.gold; super.add(x.items); }
		else super.add(x);
	}
	isEmptySlot(slot) { return this.wear[WearSlot.ordinal(slot)] == null; }
	getItemTypeInWearSlot(slot) { return this.wear[WearSlot.ordinal(slot)]; }
	setItemTypeInWearSlot(slot, type) { this.wear[WearSlot.ordinal(slot)] = type; }
	isWearing(itemTypeID, minNumber) {
		for (const w of this.wear) { if (w != null && w.id === itemTypeID) minNumber--; }
		return minNumber <= 0;
	}
	static isArmorSlot(slot) { return slot === 'head' || slot === 'body' || slot === 'hand' || slot === 'feet'; }
	_build(pred) { const inv = new Inventory(); for (const i of this.items) if (pred(i.itemType)) inv.items.push(i); return inv; }
	buildQuestItems() { return this._build((t) => t.isQuestItem()); }
	buildJewelryItems() { return this._build((t) => t.isEquippable() && !t.isWeapon() && !t.isArmor() && !t.isShield()); }
	buildPotionItems() { return this._build((t) => t.isUsable() && (t.category.id === 'pot' || t.category.id === 'healing')); }
	buildFoodItems() { return this._build((t) => t.isUsable() && !(t.category.id === 'pot' || t.category.id === 'healing')); }
	buildWeaponItems() { return this._build((t) => t.isWeapon()); }
	buildArmorItems() { return this._build((t) => t.isArmor() || t.isShield()); }
	buildOtherItems() { return this._build((t) => !(t.isEquippable() || t.isUsable() || t.isQuestItem())); }
	toJSON() {
		return {
			items: super.toJSON(), gold: this.gold,
			wear: this.wear.map((t) => (t ? t.id : null)),
			quick: this.quickitem.map((t) => (t ? t.id : null)),
		};
	}
	readJSON(o, world) {
		super.readJSON(o.items, world);
		this.gold = o.gold;
		this.wear.fill(null);
		(o.wear || []).forEach((id, i) => { if (id) this.wear[i] = world.itemTypes.getItemType(id); });
		this.quickitem.fill(null);
		(o.quick || []).forEach((id, i) => { if (id) this.quickitem[i] = world.itemTypes.getItemType(id); });
		return this;
	}
}

export class DropItem {
	constructor(itemTypeID, chance, quantity) { this.itemTypeID = itemTypeID; this.chance = chance; this.quantity = quantity; }
}
export class DropList {
	constructor(items, itemTypeCollection, itemFilterCollection) {
		this.items = items;
		this.itemTypeCollection = itemTypeCollection;
		this.itemFilterCollection = itemFilterCollection;
	}
	createRandomLoot(loot, player) {
		for (let item of this.items) {
			if (ItemTypeCollection.isItemFilter(item.itemTypeID)) {
				const f = this.itemFilterCollection.getItemFilter(item.itemTypeID);
				if (!f) continue;
				item = new DropItem(f.getRandomItem().id, item.chance, item.quantity);
			}
			const chanceRollBias = SkillController.getDropChanceRollBias(item, this.itemTypeCollection.getItemType(item.itemTypeID), player);
			if (Constants.rollResult(item.chance, chanceRollBias)) {
				const quantityRollBias = SkillController.getDropQuantityRollBias(item, player);
				const quantity = Constants.rollValue(item.quantity, quantityRollBias);
				const t = this.itemTypeCollection.getItemType(item.itemTypeID);
				if (t != null) loot.add(t, quantity);
			}
		}
	}
}
export class DropListCollection {
	static DROPLIST_STARTITEMS = 'startitems';
	constructor() { this.droplists = new Map(); }
	getDropList(id) { if (id == null || id.length <= 0) return null; return this.droplists.get(id) || null; }
	initialize(parser, input) { parser.parseRows(input, this.droplists); }
}

export class Loot {
	constructor(isVisible = true) {
		this.exp = 0;
		this.gold = 0;
		this.items = new ItemContainer();
		this.position = new Coord();
		this.isVisible = isVisible;
	}
	_addLoot(l) { this.exp += l.exp; this.gold += l.gold; this.items.add(l.items); }
	add(itemType, quantity) {
		if (ItemTypeCollection.isGoldItemType(itemType.id)) this.gold += quantity;
		else this.items.addItem(itemType, quantity);
	}
	hasItemsOrExp() { return this.exp !== 0 || this.hasItemsOrGold(); }
	hasItemsOrGold() { return this.gold !== 0 || this.hasItems(); }
	hasItems() { return !this.items.isEmpty(); }
	isContainer() { return !this.isVisible; }
	static combine(loots) { const r = new Loot(); for (const l of loots) r._addLoot(l); return r; }
	clear() { this.exp = 0; this.gold = 0; this.items.items.length = 0; }
	toJSON() { return { exp: this.exp, gold: this.gold, items: this.items.toJSON(), pos: this.position.toJSON(), vis: this.isVisible }; }
	static fromJSON(o, world) {
		const l = new Loot(o.vis);
		l.exp = o.exp; l.gold = o.gold;
		l.items.readJSON(o.items, world);
		l.position.set(o.pos[0], o.pos[1]);
		return l;
	}
}

// ---------------------------------------------------------------- actors
export class Actor {
	constructor(tileSize, isPlayer, isImmuneToCriticalHits) {
		this.iconID = 0;
		this.tileSize = tileSize;
		this.position = new Coord();
		this.rectPosition = new CoordRect(this.position, this.tileSize);
		this.isPlayer = isPlayer;
		this._isImmuneToCriticalHits = isImmuneToCriticalHits;
		this.name = '';
		this.ap = new Range();
		this.health = new Range();
		this.conditions = [];
		this.immunities = [];
		this.moveCost = 0;
		this.attackCost = 0;
		this.attackChance = 0;
		this.criticalSkill = 0;
		this.criticalMultiplier = 0;
		this.damagePotential = new Range();
		this.blockChance = 0;
		this.damageResistance = 0;
		this.onHitEffects = null;
		this.onMissEffects = null;
		this.onHitReceivedEffects = null;
		this.onMissReceivedEffects = null;
		this.onDeathEffects = null;
		this.hasVFXRunning = false;
		this.vfxStartTime = 0;
		this.vfxDuration = 0;
		this.lastPosition = new Coord();
	}
	isImmuneToCriticalHits() { return this._isImmuneToCriticalHits; }
	getName() { return this.name; }
	getCurrentAP() { return this.ap.current; }
	getMaxAP() { return this.ap.max; }
	getCurrentHP() { return this.health.current; }
	getMaxHP() { return this.health.max; }
	getMoveCost() { return this.moveCost; }
	getAttackCost() { return this.attackCost; }
	getAttackChance() { return this.attackChance; }
	getCriticalSkill() { return this.criticalSkill; }
	getCriticalMultiplier() { return this.criticalMultiplier; }
	getDamagePotential() { return this.damagePotential; }
	getBlockChance() { return this.blockChance; }
	getDamageResistance() { return this.damageResistance; }
	getOnHitEffects() { return this.onHitEffects; }
	getOnHitEffectsAsList() { return this.onHitEffects; }
	getOnMissEffects() { return this.onMissEffects; }
	getOnMissEffectsAsList() { return this.onMissEffects; }
	getOnHitReceivedEffects() { return this.onHitReceivedEffects; }
	getOnHitReceivedEffectsAsList() { return this.onHitReceivedEffects; }
	getOnMissReceivedEffects() { return this.onMissReceivedEffects; }
	getOnMissReceivedEffectsAsList() { return this.onMissReceivedEffects; }
	getOnDeathEffects() { return this.onDeathEffects; }
	hasCriticalSkillEffect() { return this.getCriticalSkill() !== 0; }
	hasCriticalMultiplierEffect() { const m = this.getCriticalMultiplier(); return m !== 0 && m !== 1; }
	hasCriticalAttacks() { return this.hasCriticalSkillEffect() && this.hasCriticalMultiplierEffect(); }
	getAttacksPerTurn() { return Math.floor(idiv(this.getMaxAP(), this.getAttackCost())); }
	getEffectiveCriticalChance() { return Actor.getEffectiveCriticalChance(this.getCriticalSkill()); }
	static getEffectiveCriticalChance(criticalSkill) {
		if (criticalSkill <= 0) return 0;
		const v = toInt(-5 + 2 * Math.sqrt(5 * criticalSkill));
		return v < 0 ? 0 : v;
	}
	isDead() { return this.health.current <= 0; }
	hasAPs(cost) { return this.ap.current >= cost; }
	hasCondition(id) { for (const c of this.conditions) if (c.conditionType.conditionTypeID === id) return true; return false; }
}

export const MonsterClass = makeEnum('humanoid', 'insect', 'demon', 'construct', 'animal', 'giant', 'undead', 'reptile', 'ghost');
export const AggressionType = makeEnum('none', 'helpOthers', 'protectSpawn', 'wholeMap', 'flee');

export class MonsterType {
	constructor(o) { Object.assign(this, o); }
	isImmuneToCriticalHits() {
		return this.monsterClass === 'ghost' || this.monsterClass === 'construct' || this.monsterClass === 'demon';
	}
	hasCombatStats() {
		if (this.attackCost !== 10) return true;
		if (this.attackChance !== 0) return true;
		if (this.criticalSkill !== 0) return true;
		if (this.criticalMultiplier !== 0) return true;
		if (this.damagePotential != null) return true;
		if (this.blockChance !== 0) return true;
		if (this.damageResistance !== 0) return true;
		return false;
	}
}
export class MonsterTypeCollection {
	constructor() { this.monsterTypesById = new Map(); }
	getMonsterType(id) { return this.monsterTypesById.get(id) || null; }
	getMonsterTypesFromSpawnGroup(spawnGroup) {
		const result = [];
		const sg = spawnGroup.toLowerCase();
		for (const t of this.monsterTypesById.values()) if (t.spawnGroup.toLowerCase() === sg) result.push(t);
		if (result.length === 0) { const t = this.monsterTypesById.get(spawnGroup); if (t) result.push(t); }
		return result;
	}
	guessMonsterTypeFromName(name) {
		const n = name.toLowerCase();
		for (const t of this.monsterTypesById.values()) if (t.name.toLowerCase() === n) return t;
		return null;
	}
	initialize(parser, input) { parser.parseRows(input, this.monsterTypesById); }
}

export class Monster extends Actor {
	constructor(monsterType, area) {
		super(monsterType.tileSize, false, monsterType.isImmuneToCriticalHits());
		this.movementDestination = null;
		this.nextActionTime = 0;
		this.forceAggressiveFlag = false;
		this.shopItems = null;
		this.monsterType = monsterType;
		this.area = area;
		this.iconID = monsterType.iconID;
		this.isFlippedX = Constants.roll100(monsterType.horizontalFlipChance);
		this.nextPosition = new CoordRect(new Coord(), monsterType.tileSize);
		this.resetStatsToBaseTraits();
		this.ap.setMax();
		this.health.setMax();
		if (this.getMoveCost() === Constants.MONSTER_IMMOBILE_MOVE_COST) this.nextActionTime = Number.MAX_SAFE_INTEGER;
	}
	resetStatsToBaseTraits() {
		const t = this.monsterType;
		this.name = t.name;
		this.ap.max = t.maxAP;
		this.health.max = t.maxHP;
		this.moveCost = t.moveCost;
		this.attackCost = t.attackCost;
		this.attackChance = t.attackChance;
		this.criticalSkill = t.criticalSkill;
		this.criticalMultiplier = t.criticalMultiplier;
		if (t.damagePotential != null) this.damagePotential.set(t.damagePotential);
		else this.damagePotential.set(0, 0);
		this.blockChance = t.blockChance;
		this.damageResistance = t.damageResistance;
		this.onHitEffects = t.onHitEffects;
		this.onHitReceivedEffects = t.onHitReceivedEffects;
		this.onDeathEffects = t.onDeathEffects;
	}
	getDropList() { return this.monsterType.dropList; }
	getExp() { return this.monsterType.exp; }
	getPhraseID() { return this.monsterType.phraseID; }
	getMonsterTypeID() { return this.monsterType.id; }
	getFaction() { return this.monsterType.faction; }
	getMonsterClass() { return this.monsterType.monsterClass; }
	getMovementAggressionType() { return this.monsterType.aggressionType; }
	createLoot(container, player) {
		let exp = this.getExp();
		exp += idiv(exp * player.getSkillLevel('moreExp') * SC.PER_SKILLPOINT_INCREASE_MORE_EXP_PERCENT, 100);
		container.exp += exp;
		const dl = this.getDropList();
		if (dl == null) return;
		dl.createRandomLoot(container, player);
	}
	getShopItems(player) {
		if (this.shopItems != null) return this.shopItems;
		const loot = new Loot();
		this.shopItems = loot.items;
		const dl = this.getDropList();
		if (dl) dl.createRandomLoot(loot, player);
		return this.shopItems;
	}
	resetShopItems() { this.shopItems = null; }
	isAdjacentTo(p) { return this.rectPosition.isAdjacentTo(p.position); }
	isAgressive(p) {
		return this.getPhraseID() == null || this.forceAggressiveFlag || (p != null && this.getFaction() != null && p.getAlignment(this.getFaction()) < 0);
	}
	forceAggressive() { this.forceAggressiveFlag = true; }
	toJSON() {
		const t = this.monsterType;
		const o = { t: t.id, ap: this.ap.toJSON(), hp: this.health.toJSON(), pos: this.position.toJSON(),
			c: this.conditions.map((c) => c.toJSON()), mc: this.moveCost, fa: this.forceAggressiveFlag };
		const dp = t.damagePotential;
		if (!(this.attackCost === t.attackCost && this.attackChance === t.attackChance && this.criticalSkill === t.criticalSkill
			&& this.criticalMultiplier === t.criticalMultiplier && this.damagePotential.equals(dp)
			&& this.blockChance === t.blockChance && this.damageResistance === t.damageResistance)) {
			o.cs = [this.attackCost, this.attackChance, this.criticalSkill, this.criticalMultiplier, this.damagePotential.toJSON(), this.blockChance, this.damageResistance];
		}
		if (this.shopItems != null) o.shop = this.shopItems.toJSON();
		return o;
	}
	static fromJSON(o, world, area) {
		const t = world.monsterTypes.getMonsterType(o.t);
		if (!t) return null;
		const m = new Monster(t, area);
		if (o.cs) {
			[m.attackCost, m.attackChance, m.criticalSkill, m.criticalMultiplier] = o.cs;
			m.damagePotential.set(o.cs[4][0], o.cs[4][1]);
			m.blockChance = o.cs[5]; m.damageResistance = o.cs[6];
		}
		m.ap.set(o.ap[0], o.ap[1]);
		m.health.set(o.hp[0], o.hp[1]);
		m.position.set(o.pos[0], o.pos[1]);
		for (const c of o.c) { const ac = ActorCondition.fromJSON(c, world); if (ac) m.conditions.push(ac); }
		m.moveCost = o.mc;
		m.forceAggressiveFlag = o.fa;
		if (o.shop) m.shopItems = ItemContainer.fromJSON(o.shop, world);
		return m;
	}
}

export const StatID = makeEnum('maxHP', 'maxAP', 'moveCost', 'attackCost', 'attackChance', 'criticalSkill',
	'criticalMultiplier', 'damagePotentialMin', 'damagePotentialMax', 'blockChance', 'damageResistance');

export class PlayerBaseTraits {
	constructor() {
		this.iconID = 0; this.maxAP = 0; this.maxHP = 0; this.moveCost = 0; this.attackCost = 0;
		this.attackChance = 0; this.criticalSkill = 0; this.criticalMultiplier = 0;
		this.damagePotential = new Range(); this.blockChance = 0; this.damageResistance = 0;
		this.useItemCost = 0; this.reequipCost = 0;
	}
}

function uuid() {
	if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
	});
}

export class Player extends Actor {
	static DEFAULT_PLAYER_ATTACKCOST = 4;
	constructor() {
		super(new Size(1, 1), true, false);
		this.nextPosition = new Coord();
		this.mapIconID = 0;
		this.level = 0;
		this.baseTraits = new PlayerBaseTraits();
		this.levelExperience = new Range();
		this.inventory = new Inventory();
		this.skillLevels = new Map();
		this.availableSkillIncreases = 0;
		this.useItemCost = 0;
		this.reequipCost = 0;
		this.totalExperience = 0;
		this.weaponDamage = new Range();
		this.questProgress = new Map(); // questID -> Set<int> (insertion ordered)
		this.spawnMap = null;
		this.spawnPlace = null;
		this.alignments = new Map();
		this.id = uuid();
		this.savedVersion = 1;
	}
	resetStatsToBaseTraits() {
		const b = this.baseTraits;
		this.iconID = b.iconID;
		this.ap.max = b.maxAP;
		this.health.max = b.maxHP;
		this.moveCost = b.moveCost;
		this.attackCost = b.attackCost;
		this.attackChance = b.attackChance;
		this.criticalSkill = b.criticalSkill;
		this.criticalMultiplier = b.criticalMultiplier;
		this.damagePotential.set(b.damagePotential);
		this.blockChance = b.blockChance;
		this.damageResistance = b.damageResistance;
		this.useItemCost = b.useItemCost;
		this.reequipCost = b.reequipCost;
	}
	initializeNewPlayer(dropLists, playerName, playerIcon) {
		const b = this.baseTraits;
		b.iconID = playerIcon;
		b.maxAP = 10; b.maxHP = 25; b.moveCost = 6;
		b.attackCost = Player.DEFAULT_PLAYER_ATTACKCOST;
		b.attackChance = 60; b.criticalSkill = 0; b.criticalMultiplier = 1;
		b.damagePotential.set(1, 1);
		b.blockChance = 9; b.damageResistance = 0; b.useItemCost = 5; b.reequipCost = 5;
		this.name = playerName;
		this.level = 1;
		this.totalExperience = 1;
		this.inventory.clear();
		this.questProgress.clear();
		this.skillLevels.clear();
		this.availableSkillIncreases = 0;
		this.alignments.clear();
		this.ap.set(b.maxAP, b.maxAP);
		this.health.set(b.maxHP, b.maxHP);
		this.conditions.length = 0;
		this.weaponDamage.set(0, 0);
		const startItems = new Loot();
		dropLists.getDropList(DropListCollection.DROPLIST_STARTITEMS).createRandomLoot(startItems, this);
		this.inventory.add(startItems);
		this.spawnMap = 'home';
		this.spawnPlace = 'rest';
	}
	hasExactQuestProgress(questID, progress) {
		if (typeof questID === 'object') { progress = questID.progress; questID = questID.questID; }
		const s = this.questProgress.get(questID);
		return s ? s.has(progress) : false;
	}
	hasAnyQuestProgress(questID) { return this.questProgress.has(questID); }
	getAllQuestProgressIDs() { return [...this.questProgress.keys()]; }
	isLatestQuestProgress(questID, progress) {
		const s = this.questProgress.get(questID);
		if (!s || !s.has(progress)) return false;
		for (const i of s) if (i > progress) return false;
		return true;
	}
	getQuestProgress(questID) { const s = this.questProgress.get(questID); return s ? [...s] : []; }
	addQuestProgress(progress) {
		if (this.hasExactQuestProgress(progress.questID, progress.progress)) return false;
		if (!this.questProgress.has(progress.questID)) this.questProgress.set(progress.questID, new Set());
		this.questProgress.get(progress.questID).add(progress.progress);
		return true;
	}
	removeQuestProgress(progress) {
		if (!this.hasExactQuestProgress(progress.questID, progress.progress)) return false;
		this.questProgress.get(progress.questID).delete(progress.progress);
		return true;
	}
	recalculateLevelExperience() {
		const req = Player.getRequiredExperience(this.level);
		this.levelExperience.set(Player.getRequiredExperienceForNextLevel(this.level), this.totalExperience - req);
	}
	static getRequiredExperience(currentLevel) {
		let v = 0;
		for (let i = 1; i < currentLevel; ++i) v += Player.getRequiredExperienceForNextLevel(i);
		return v;
	}
	static getRequiredExperienceForNextLevel(currentLevel) { return 55 * currentLevel * currentLevel; }
	canLevelup() { return this.levelExperience.isMax(); }
	addSkillLevel(skillID) { this.skillLevels.set(skillID, this.getSkillLevel(skillID) + 1); }
	getSkillLevel(skillID) { return this.skillLevels.get(skillID) || 0; }
	hasSkill(skillID) { return this.getSkillLevel(skillID) > 0; }
	nextLevelAddsNewSkillpoint() { return Player.thisLevelAddsNewSkillpoint(this.level + 1); }
	static thisLevelAddsNewSkillpoint(level) {
		return (level - Constants.FIRST_SKILL_POINT_IS_GIVEN_AT_LEVEL) % Constants.NEW_SKILL_POINT_EVERY_N_LEVELS === 0;
	}
	hasAvailableSkillpoints() { return this.availableSkillIncreases > 0; }
	getAlignment(faction) { const v = this.alignments.get(faction); return v == null ? 0 : v; }
	setAlignment(faction, v) { this.alignments.set(faction, v); }
	addAlignment(faction, delta) { this.alignments.set(faction, this.getAlignment(faction) + delta); }
	setSpawnPlace(spawnMap, spawnPlace) { this.spawnPlace = spawnPlace; this.spawnMap = spawnMap; }
	setName(name) { this.name = name; }
	replaceIcon(iconId) { this.mapIconID = iconId; }
	getReequipCost() { return this.reequipCost; }
	getUseItemCost() { return this.useItemCost; }
	getAvailableSkillIncreases() { return this.availableSkillIncreases; }
	getLevel() { return this.level; }
	getTotalExperience() { return this.totalExperience; }
	getCurrentLevelExperience() { return this.levelExperience.current; }
	getMaxLevelExperience() { return this.levelExperience.max; }
	getGold() { return this.inventory.gold; }
	getSpawnMap() { return this.spawnMap; }
	getSpawnPlace() { return this.spawnPlace; }
	getStatValue(stat) {
		const b = this.baseTraits;
		switch (stat) {
			case 'maxHP': return b.maxHP;
			case 'maxAP': return b.maxAP;
			case 'moveCost': return b.moveCost;
			case 'attackCost': return b.attackCost;
			case 'attackChance': return b.attackChance;
			case 'criticalSkill': return b.criticalSkill;
			case 'criticalMultiplier': return Math.floor(b.criticalMultiplier);
			case 'damagePotentialMin': return b.damagePotential.current;
			case 'damagePotentialMax': return b.damagePotential.max;
			case 'blockChance': return b.blockChance;
			case 'damageResistance': return b.damageResistance;
		}
		return 0;
	}
	toJSON() {
		const b = this.baseTraits;
		return {
			base: { iconID: b.iconID, maxAP: b.maxAP, maxHP: b.maxHP, moveCost: b.moveCost, attackCost: b.attackCost,
				attackChance: b.attackChance, criticalSkill: b.criticalSkill, criticalMultiplier: b.criticalMultiplier,
				damagePotential: b.damagePotential.toJSON(), blockChance: b.blockChance, damageResistance: b.damageResistance,
				useItemCost: b.useItemCost, reequipCost: b.reequipCost },
			mapIconID: this.mapIconID, name: this.name, moveCost: this.moveCost,
			ap: this.ap.toJSON(), hp: this.health.toJSON(), pos: this.position.toJSON(),
			conditions: this.conditions.map((c) => c.toJSON()), immunities: this.immunities.map((c) => c.toJSON()),
			lastPos: this.lastPosition.toJSON(), nextPos: this.nextPosition.toJSON(),
			level: this.level, totalExperience: this.totalExperience,
			inventory: this.inventory.toJSON(),
			skills: [...this.skillLevels.entries()],
			spawnMap: this.spawnMap, spawnPlace: this.spawnPlace,
			quests: [...this.questProgress.entries()].map(([k, s]) => [k, [...s]]),
			availableSkillIncreases: this.availableSkillIncreases,
			alignments: [...this.alignments.entries()],
			id: this.id, savedVersion: this.savedVersion,
		};
	}
	static fromJSON(o, world) {
		const p = new Player();
		const b = p.baseTraits;
		Object.assign(b, o.base, { damagePotential: Range.fromJSON(o.base.damagePotential) });
		p.mapIconID = o.mapIconID; p.name = o.name; p.moveCost = o.moveCost;
		p.ap.set(o.ap[0], o.ap[1]); p.health.set(o.hp[0], o.hp[1]); p.position.set(o.pos[0], o.pos[1]);
		for (const c of o.conditions) { const ac = ActorCondition.fromJSON(c, world); if (ac) p.conditions.push(ac); }
		for (const c of o.immunities) { const ac = ActorCondition.fromJSON(c, world); if (ac) p.immunities.push(ac); }
		p.lastPosition.set(o.lastPos[0], o.lastPos[1]);
		p.nextPosition.set(o.nextPos[0], o.nextPos[1]);
		p.level = o.level; p.totalExperience = o.totalExperience;
		p.inventory.readJSON(o.inventory, world);
		for (const [k, v] of o.skills) p.skillLevels.set(k, v);
		p.spawnMap = o.spawnMap; p.spawnPlace = o.spawnPlace;
		for (const [k, arr] of o.quests) p.questProgress.set(k, new Set(arr));
		p.availableSkillIncreases = o.availableSkillIncreases;
		for (const [k, v] of o.alignments) p.alignments.set(k, v);
		p.id = o.id; p.savedVersion = o.savedVersion;
		return p;
	}
}

// Heroes (HeroCollection): sprites resolved by TileManager/DynamicTileLoader
export const HeroCollection = {
	heroes: [
		{ tileIdInSpritesheet: 0, small: 'char_hero', large: 'char_hero_large', tileIdInManager: 0 },
		{ tileIdInSpritesheet: 0, small: 'char_hero_maksiu_girl_01', large: 'char_hero_maksiu_girl_01_large', tileIdInManager: 0 },
		{ tileIdInSpritesheet: 0, small: 'char_hero_maksiu_boy_01', large: 'char_hero_maksiu_boy_01_large', tileIdInManager: 0 },
	],
	getHeroTileIdForTileManage(heroId) { const h = this.heroes[heroId - 1]; return h ? h.tileIdInManager : -1; },
	getHeroSmallSprite(heroId) { const h = this.heroes[heroId - 1]; return h ? h.small : null; },
	getHeroLargeSprite(heroId) { const h = this.heroes[heroId - 1]; return h ? h.large : null; },
	prepareHeroesTileId(loader) {
		for (const h of this.heroes) h.tileIdInManager = loader.prepareTileID(h.small, h.tileIdInSpritesheet);
	},
};

// ---------------------------------------------------------------- conversation / quest / script
export const ConversationCollection = {
	PHRASE_CLOSE: 'X', PHRASE_SHOP: 'S', PHRASE_ATTACK: 'F', PHRASE_REMOVE: 'R', REPLY_NEXT: 'N',
};
export class ConversationCollectionImpl {
	constructor() { this.phrases = new Map(); }
	hasPhrase(id) { return this.phrases.has(id); }
	getPhrase(id) { return this.phrases.get(id) || null; }
	initialize(parser, input) { return parser.parseRows(input, this.phrases); }
}
export class Phrase {
	constructor(message, replies, scriptEffects, switchToNPC) {
		this.message = message;
		this.replies = replies && replies.length ? replies : [];
		this.scriptEffects = scriptEffects;
		this.switchToNPC = switchToNPC;
	}
}
export class Reply {
	constructor(text, nextPhrase, requires) { this.text = text; this.nextPhrase = nextPhrase; this.requires = requires; }
	hasRequirements() { return this.requires != null; }
}

export class QuestLogEntry {
	constructor(progress, logtext, rewardExperience, finishesQuest) {
		Object.assign(this, { progress, logtext, rewardExperience, finishesQuest });
	}
}
export class Quest {
	constructor(questID, name, stages, showInLog, sortOrder) {
		Object.assign(this, { questID, name, stages, showInLog, sortOrder });
	}
	getQuestLogEntry(progress) { for (const s of this.stages) if (s.progress === progress) return s; return null; }
	isCompleted(player) {
		for (const e of this.stages) if (e.finishesQuest && player.hasExactQuestProgress(this.questID, e.progress)) return true;
		return false;
	}
}
export class QuestCollection {
	constructor() { this.quests = new Map(); }
	getAllQuests() { return [...this.quests.values()].sort((a, b) => a.sortOrder - b.sortOrder); }
	getQuestLogEntry(stage) { const q = this.getQuest(stage.questID); return q == null ? null : q.getQuestLogEntry(stage.progress); }
	getQuest(id) { return this.quests.get(id) || null; }
	initialize(parser, input) { parser.parseRows(input, this.quests); }
}
export class QuestProgress {
	constructor(questID, progress) { this.questID = questID; this.progress = progress; }
	static parseQuestProgress(v) {
		if (v == null || v.length <= 0) return null;
		const parts = v.split(':');
		let p = 0;
		if (parts.length >= 2) { const n = parseInt(parts[1], 10); p = Number.isNaN(n) ? 0 : n; }
		return new QuestProgress(parts[0], p);
	}
	toString() { return this.questID + ':' + this.progress; }
}

export const RequirementType = makeEnum('questProgress', 'questLatestProgress', 'inventoryRemove', 'inventoryKeep',
	'wear', 'skillLevel', 'killedMonster', 'timerElapsed', 'usedItem', 'spentGold', 'consumedBonemeals',
	'hasActorCondition', 'factionScore', 'random', 'factionScoreEquals', 'wearRemove', 'date', 'dateEquals',
	'time', 'timeEquals', 'skillIncrease');

export class Requirement {
	constructor(requireType, requireID, value, negate, chance) {
		if (requireType instanceof QuestProgress) {
			const qp = requireType;
			this.requireType = 'questProgress'; this.requireID = qp.questID; this.value = qp.progress;
			this.negate = false; this.chance = null;
			return;
		}
		Object.assign(this, { requireType, requireID, value, negate, chance });
	}
	toString() { return this.requireType + '--' + this.requireID + '--' + (this.negate ? '!' : '') + this.value; }
	isValid() {
		const id = this.requireID != null, v = this.value >= 0;
		switch (this.requireType) {
			case 'consumedBonemeals': return v;
			case 'hasActorCondition': case 'factionScore': case 'factionScoreEquals': return id;
			case 'inventoryKeep': case 'inventoryRemove': case 'wear': case 'wearRemove': case 'usedItem':
			case 'killedMonster': case 'questLatestProgress': case 'questProgress': case 'skillLevel':
			case 'skillIncrease': case 'timerElapsed':
				return id && v;
			case 'spentGold': case 'date': case 'dateEquals': case 'time': case 'timeEquals': return v;
			case 'random': return this.chance != null;
			default: return false;
		}
	}
}

export const ScriptEffectType = makeEnum('questProgress', 'dropList', 'skillIncrease', 'actorCondition',
	'actorConditionImmunity', 'alignmentChange', 'alignmentSet', 'alignmentToReg1', 'alignmentToReg2',
	'alignmentToReg3', 'alignmentFromReg1', 'alignmentFromReg2', 'alignmentFromReg3', 'alignmentAdd',
	'alignmentSub', 'alignmentMult', 'alignmentDiv', 'giveItem', 'createTimer', 'spawnAll', 'removeSpawnArea',
	'deactivateSpawnArea', 'activateMapObjectGroup', 'deactivateMapObjectGroup', 'removeQuestProgress',
	'changeMapFilter', 'mapchange', 'changeIcon', 'setNextPhraseID');

export class ScriptEffect {
	constructor(type, effectID, value, mapName, requires) {
		Object.assign(this, { type, effectID, value, mapName, requires });
	}
	hasRequirements() { return this.requires != null; }
}

// ---------------------------------------------------------------- misc model
export class CombatLog {
	constructor() { this.messages = []; }
	static MAX = 100;
	append(msg) { while (this.messages.length >= CombatLog.MAX) this.messages.shift(); this.messages.push(msg); }
	appendCombatEnded() {
		if (this.messages.length === 0) return;
		if (this.messages[this.messages.length - 1] === '--') return;
		this.append('--');
	}
	getLastMessages() {
		if (this.messages.length === 0) return '';
		const out = [this.messages[this.messages.length - 1]];
		for (let i = this.messages.length - 2, n = 1; i >= 0 && n++ < 3; --i) {
			if (this.messages[i] === '--') break;
			out.unshift(this.messages[i]);
		}
		return out.join('\n');
	}
	getAllMessages() { return [...this.messages]; }
}

export class GameStatistics {
	constructor(unlimitedSaves = true, startLives = -1) {
		this.isAlteredSavegame = false;
		this.deaths = 0;
		this.killedMonstersByTypeID = new Map();
		this.killedMonstersByName = new Map();
		this.usedItems = new Map();
		this.spentGold = 0;
		this.unlimitedSaves = unlimitedSaves;
		this.startLives = startLives;
	}
	addMonsterKill(t) {
		this.killedMonstersByTypeID.set(t.id, this.getNumberOfKillsForMonsterType(t.id) + 1);
		this.killedMonstersByName.set(t.name, this.getNumberOfKillsForMonsterName(t.name) + 1);
	}
	addPlayerDeath(lostExp) { ++this.deaths; }
	addGoldSpent(amount) { this.spentGold += amount; }
	addItemUsage(type) { this.usedItems.set(type.id, (this.usedItems.get(type.id) || 0) + 1); }
	getDeaths() { return this.deaths; }
	getSpentGold() { return this.spentGold; }
	hasUnlimitedSaves() { return this.unlimitedSaves; }
	hasUnlimitedLives() { return this.startLives === -1; }
	getStartLives() { return this.startLives; }
	getLivesLeft() { return this.hasUnlimitedLives() ? -1 : this.startLives - this.deaths; }
	isDead() { return !this.hasUnlimitedLives() && this.getLivesLeft() < 1; }
	getNumberOfKillsForMonsterType(id) { return this.killedMonstersByTypeID.get(id) || 0; }
	getNumberOfKillsForMonsterName(n) { return this.killedMonstersByName.get(n) || 0; }
	getTop5MostCommonlyKilledMonsters() {
		if (this.killedMonstersByTypeID.size === 0) return null;
		return [...this.killedMonstersByName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
			.map(([k, v]) => `${k} (${v})`).join('\n');
	}
	getMostPowerfulKilledMonster(world) {
		let best = null, bestExp = -1;
		for (const id of this.killedMonstersByTypeID.keys()) {
			const t = world.monsterTypes.getMonsterType(id);
			const e = t ? t.exp : 0;
			if (e > bestExp) { bestExp = e; best = t; }
		}
		return best ? best.name : null;
	}
	getMostCommonlyUsedItem(world) {
		if (this.usedItems.size === 0) return null;
		const [id, n] = [...this.usedItems.entries()].sort((a, b) => b[1] - a[1])[0];
		const t = world.itemTypes.getItemType(id);
		return t ? `${t.getName(world.model.player)} (${n})` : null;
	}
	getNumberOfUsedBonemealPotions() {
		return (this.usedItems.get('bonemeal_potion') || 0) + (this.usedItems.get('pot_bm_lodar') || 0) + (this.usedItems.get('pot_bm_kazaul') || 0);
	}
	getNumberOfCompletedQuests(world) {
		let r = 0;
		for (const q of world.quests.getAllQuests()) if (q.showInLog && q.isCompleted(world.model.player)) ++r;
		return r;
	}
	getNumberOfVisitedMaps(world) { let r = 0; for (const m of world.maps.getAllMaps()) if (m.visited) ++r; return r; }
	getNumberOfUsedItems() { let s = 0; for (const v of this.usedItems.values()) s += v; return s; }
	getNumberOfTimesItemHasBeenUsed(id) { return this.usedItems.get(id) || 0; }
	getNumberOfKilledMonsters() { let s = 0; for (const v of this.killedMonstersByTypeID.values()) s += v; return s; }
	toJSON() {
		return { deaths: this.deaths, kills: [...this.killedMonstersByTypeID.entries()], used: [...this.usedItems.entries()],
			spentGold: this.spentGold, startLives: this.startLives, unlimitedSaves: this.unlimitedSaves };
	}
	static fromJSON(o, world) {
		const s = new GameStatistics(o.unlimitedSaves, o.startLives);
		s.deaths = o.deaths;
		for (const [id, v] of o.kills) {
			s.killedMonstersByTypeID.set(id, v);
			const t = world.monsterTypes.getMonsterType(id);
			if (t) s.killedMonstersByName.set(t.name, s.getNumberOfKillsForMonsterName(t.name) + v);
		}
		for (const [id, v] of o.used) s.usedItems.set(id, v);
		s.spentGold = o.spentGold;
		return s;
	}
}

export class InterfaceData {
	constructor() {
		this.isMainActivityVisible = false;
		this.isInCombat = false;
		this.isPlayersCombatTurn = false;
		this.selectedMonster = null;
		this.selectedPosition = null;
		this.selectedTabHeroInfo = '';
		this.selectedQuestFilter = 0;
		this.selectedInventoryCategory = 0;
		this.selectedInventorySort = 0;
		this.selectedSkillCategory = 0;
		this.selectedSkillSort = 0;
		this.selectedShopSort = 0;
	}
	toJSON() { return { inCombat: this.isInCombat, sel: this.selectedPosition ? this.selectedPosition.toJSON() : null }; }
}

export class WorldData {
	constructor() { this.worldTime = 0; this.timers = new Map(); this.nextPhraseID = null; }
	tickWorldTime(ticks = 1) { this.worldTime += ticks; }
	getWorldTime() { return this.worldTime; }
	createTimer(name) { this.timers.set(name, this.worldTime); }
	removeTimer(name) { this.timers.delete(name); }
	hasTimerElapsed(name, duration) {
		const v = this.timers.get(name);
		if (v == null) return false;
		return v + duration <= this.worldTime;
	}
	getDate(format) {
		const n = new Date(), Y = n.getFullYear(), M = n.getMonth() + 1, D = n.getDate();
		switch (format) {
			case 'YYYYMMDD': return Y * 10000 + M * 100 + D;
			case 'YYYYMM': return Y * 100 + M;
			case 'YYYY': return Y;
			case 'MMDD': return M * 100 + D;
			case 'MM': return M;
			case 'DD': return D;
			default: return 99999999;
		}
	}
	getTime(format) {
		const n = new Date(), h = n.getHours(), m = n.getMinutes(), s = n.getSeconds();
		switch (format) {
			case 'HHMMSS': return h * 10000 + m * 100 + s;
			case 'HHMM': return h * 100 + m;
			case 'HH': return h;
			case 'MMSS': return m * 100 + s;
			case 'MM': return m;
			case 'SS': return s;
			default: return 99999999;
		}
	}
	toJSON() { return { t: this.worldTime, timers: [...this.timers.entries()] }; }
	static fromJSON(o) { const w = new WorldData(); w.worldTime = o.t; for (const [k, v] of o.timers) w.timers.set(k, v); return w; }
}

export class MapBundle { constructor() { this.map = null; this.tileMap = null; this.tiles = null; } }

export class ModelContainer {
	constructor(startLives = -1, unlimitedSaves = true) {
		this.player = new Player();
		this.uiSelections = new InterfaceData();
		this.combatLog = new CombatLog();
		this.statistics = new GameStatistics(unlimitedSaves, startLives);
		this.worldData = new WorldData();
		this.currentMaps = new MapBundle();
	}
}

// ---------------------------------------------------------------- maps
export const MapObjectType = makeEnum('sign', 'newmap', 'rest', 'keyarea', 'container', 'script');
export const MapObjectEvaluationType = makeEnum('whenEntering', 'onEveryStep', 'afterEveryRound', 'continuously');

export class MapObject {
	constructor(position, type, id, map, place, enteringRequirement, dropList, evaluateWhen, group) {
		this.position = new CoordRect(position);
		Object.assign(this, { type, id, map, place, enteringRequirement, dropList, evaluateWhen, group });
		this.isActive = true;
	}
	static createMapSignEvent(position, phraseID, group) { return new MapObject(position, 'sign', phraseID, null, null, null, null, 'whenEntering', group); }
	static createMapChangeArea(position, title, map, place, group) { return new MapObject(position, 'newmap', title, map, place, null, null, 'whenEntering', group); }
	static createRestArea(position, placeId, group) { return new MapObject(position, 'rest', placeId, null, null, null, null, 'whenEntering', group); }
	static createKeyArea(position, phraseID, req, group) { return new MapObject(position, 'keyarea', phraseID, null, null, req, null, 'whenEntering', group); }
	static createContainerArea(position, dropList, group) { return new MapObject(position, 'container', null, null, null, null, dropList, 'whenEntering', group); }
	static createScriptArea(position, phraseID, when, group) { return new MapObject(position, 'script', phraseID, null, null, null, null, when, group); }
}

export class MonsterSpawnArea {
	constructor(area, quantity, respawnspeed, areaID, monsterTypeIDs, isUnique, ignoreAreas, group, isSpawningForNewGame) {
		Object.assign(this, { area, quantity, respawnspeed, areaID, monsterTypeIDs, isUnique, ignoreAreas, group, isSpawningForNewGame });
		this.monsters = [];
		this.isSpawning = isSpawningForNewGame;
	}
	getMonsterAt(p, y) {
		if (p instanceof CoordRect) { for (const m of this.monsters) if (m.rectPosition.intersects(p)) return m; return null; }
		let x = p; if (typeof p !== 'number') { x = p.x; y = p.y; }
		for (const m of this.monsters) if (m.rectPosition.contains(x, y)) return m;
		return null;
	}
	findSpawnedMonster(id) { for (const m of this.monsters) if (m.getMonsterTypeID() === id) return m; return null; }
	getRandomMonsterType(world) {
		return world.monsterTypes.getMonsterType(this.monsterTypeIDs[rnd.nextInt(this.monsterTypeIDs.length)]);
	}
	spawn(p, type) {
		const m = new Monster(type, this);
		m.position.set(p);
		this.monsters.push(m);
		this.quantity.current++;
		return m;
	}
	remove(m) { const i = this.monsters.indexOf(m); if (i >= 0) { this.monsters.splice(i, 1); this.quantity.current--; } }
	isSpawnable(includeUnique) {
		if (!this.isSpawning) return false;
		if (this.isUnique && !includeUnique) return false;
		return this.quantity.current < this.quantity.max;
	}
	rollShouldSpawn() { return Constants.rollResult(this.respawnspeed); }
	removeAllMonsters() { this.monsters.length = 0; this.quantity.current = 0; }
	resetShops() { for (const m of this.monsters) m.resetShopItems(); }
	resetForNewGame() { this.removeAllMonsters(); this.isSpawning = this.isSpawningForNewGame; }
	toJSON() { return { s: this.isSpawning, m: this.monsters.map((m) => m.toJSON()) }; }
	readJSON(o, world) {
		this.monsters.length = 0;
		this.isSpawning = o.s;
		for (const mo of o.m) { const m = Monster.fromJSON(mo, world, this); if (m) this.monsters.push(m); }
		this.quantity.current = this.monsters.length;
	}
}

export class PredefinedMap {
	constructor(xmlResourceId, name, size, eventObjects, spawnAreas, initiallyActiveMapObjectGroups, isOutdoors, colorFilter) {
		this.xmlResourceId = xmlResourceId;
		this.name = name;
		this.size = size;
		this.eventObjects = eventObjects;
		this.spawnAreas = spawnAreas;
		this.initiallyActiveMapObjectGroups = initiallyActiveMapObjectGroups;
		this.activeMapObjectGroups = [...initiallyActiveMapObjectGroups];
		this.groundBags = [];
		this.initialColorFilter = colorFilter;
		this.visited = false;
		this.lastVisitTime = 0;
		this.lastSeenLayoutHash = '';
		this.isOutdoors = isOutdoors;
		this.currentColorFilter = null;
		this.splatters = [];
		this.activateMapObjects();
	}
	isOutside(p, y) {
		if (p instanceof CoordRect) {
			if (this.isOutside(p.topLeft)) return true;
			if (p.topLeft.x + p.size.width > this.size.width) return true;
			if (p.topLeft.y + p.size.height > this.size.height) return true;
			return false;
		}
		let x = p; if (typeof p !== 'number') { x = p.x; y = p.y; }
		return x < 0 || y < 0 || x >= this.size.width || y >= this.size.height;
	}
	intersects(area) { return new CoordRect(new Coord(0, 0), this.size).intersects(area); }
	findEventObject(type, name) { for (const o of this.eventObjects) if (o.type === type && name === o.id) return o; return null; }
	getActiveEventObjectsAt(p) {
		let r = null;
		for (const o of this.eventObjects) {
			if (!o.isActive || !o.position.contains(p)) continue;
			(r || (r = [])).push(o);
		}
		return r;
	}
	hasContainerAt(p) {
		for (const o of this.eventObjects) if (o.isActive && o.type === 'container' && o.position.contains(p)) return true;
		return false;
	}
	getMonsterAt(p, exceptMe) {
		if (p instanceof CoordRect) {
			for (const a of this.spawnAreas) {
				const m = a.getMonsterAt(p);
				if (m != null && (exceptMe == null || exceptMe !== m)) return m;
			}
			return null;
		}
		let x = p, y = exceptMe; if (typeof p !== 'number') { x = p.x; y = p.y; }
		for (const a of this.spawnAreas) { const m = a.getMonsterAt(x, y); if (m) return m; }
		return null;
	}
	findSpawnedMonster(id) { for (const a of this.spawnAreas) { const m = a.findSpawnedMonster(id); if (m) return m; } return null; }
	getBagAt(p) { for (const l of this.groundBags) if (l.position.equals(p)) return l; return null; }
	getBagOrCreateAt(position) {
		let b = this.getBagAt(position);
		if (b) return b;
		b = new Loot(!this.hasContainerAt(position));
		b.position.set(position);
		if (this.isOutside(position)) return b;
		this.groundBags.push(b);
		return b;
	}
	itemDropped(itemType, quantity, position) { this.getBagOrCreateAt(position).items.addItem(itemType, quantity); }
	removeGroundLoot(loot) { const i = this.groundBags.indexOf(loot); if (i >= 0) this.groundBags.splice(i, 1); }
	resetForNewGame() {
		for (const a of this.spawnAreas) a.resetForNewGame();
		this.activeMapObjectGroups = [...this.initiallyActiveMapObjectGroups];
		this.activateMapObjects();
		this.resetTemporaryData();
		this.groundBags.length = 0;
		this.visited = false;
		this.currentColorFilter = this.initialColorFilter;
		this.lastSeenLayoutHash = '';
	}
	isRecentlyVisited() {
		if (this.lastVisitTime === 0) return false;
		return (Date.now() - this.lastVisitTime) < Constants.MAP_UNVISITED_RESPAWN_DURATION_MS;
	}
	updateLastVisitTime() { this.lastVisitTime = Date.now(); }
	resetTemporaryData() {
		for (const a of this.spawnAreas) { if (a.isUnique) a.resetShops(); else a.removeAllMonsters(); }
		this.splatters.length = 0;
		this.lastVisitTime = 0;
	}
	hasResetTemporaryData() { return this.lastVisitTime === 0; }
	createAllContainerLoot() {
		for (const o of this.eventObjects) if (o.isActive && o.type === 'container') this.createContainerLoot(o);
	}
	createContainerLoot(container) {
		const bag = this.getBagOrCreateAt(container.position.topLeft);
		container.dropList.createRandomLoot(bag, null);
	}
	activateMapObjects() { for (const o of this.eventObjects) o.isActive = this.activeMapObjectGroups.includes(o.group); }
	activateMapObjectGroup(group) {
		if (this.activeMapObjectGroups.includes(group)) return;
		this.activeMapObjectGroups.push(group);
		for (const o of this.eventObjects) {
			if (o.group === group) { o.isActive = true; if (o.type === 'container') this.createContainerLoot(o); }
		}
	}
	deactivateMapObjectGroup(group) {
		const i = this.activeMapObjectGroups.indexOf(group);
		if (i < 0) return;
		this.activeMapObjectGroups.splice(i, 1);
		for (const o of this.eventObjects) if (o.group === group) o.isActive = false;
	}
	shouldSaveMapData(world) {
		if (!this.hasResetTemporaryData()) return true;
		if (this === world.model.currentMaps.map) return true;
		if (this.groundBags.length) return true;
		for (const a of this.spawnAreas) {
			if (this.visited && a.isUnique) return true;
			if (a.isSpawning !== a.isSpawningForNewGame) return true;
		}
		const A = this.activeMapObjectGroups, I = this.initiallyActiveMapObjectGroups;
		if (!I.every((g) => A.includes(g)) || !A.every((g) => I.includes(g))) return true;
		if (this.currentColorFilter != null) return true;
		return false;
	}
	toJSON(world) {
		const o = { v: this.visited, h: this.lastSeenLayoutHash };
		if (this.shouldSaveMapData(world)) {
			o.d = {
				spawns: this.spawnAreas.map((a) => [a.areaID, a.toJSON()]),
				groups: [...this.activeMapObjectGroups],
				bags: this.groundBags.map((l) => l.toJSON()),
				filter: this.currentColorFilter,
				lastVisit: this.lastVisitTime,
			};
		}
		return o;
	}
	readJSON(o, world, controllers) {
		this.visited = o.v;
		this.lastSeenLayoutHash = o.h || '';
		const loaded = new Set();
		if (o.d) {
			for (const [id, so] of o.d.spawns) {
				const a = this.spawnAreas.find((s) => s.areaID === id);
				if (a) { a.readJSON(so, world); loaded.add(a); }
			}
			this.activeMapObjectGroups = [...o.d.groups];
			this.activateMapObjects();
			this.groundBags = o.d.bags.map((b) => Loot.fromJSON(b, world));
			this.currentColorFilter = o.d.filter;
			this.lastVisitTime = o.d.lastVisit;
		} else {
			this.activeMapObjectGroups = [...this.initiallyActiveMapObjectGroups];
			this.activateMapObjects();
		}
		for (const a of this.spawnAreas) {
			if (loaded.has(a)) continue;
			if (a.isUnique && this.visited) controllers.monsterSpawnController.spawnAllInArea(this, null, a, true);
			else a.resetForNewGame();
		}
	}
}

export class MapCollection {
	constructor() {
		this.predefinedMaps = new Map();
		this.worldMapSegments = new Map();
		this.worldMapRequiresUpdate = true;
	}
	addAll(maps) { for (const m of maps) this.predefinedMaps.set(m.name, m); }
	getAllMaps() { return [...this.predefinedMaps.values()]; }
	findPredefinedMap(name) { return this.predefinedMaps.get(name) || null; }
	resetForNewGame() { for (const m of this.predefinedMaps.values()) m.resetForNewGame(); this.worldMapRequiresUpdate = true; }
	getWorldMapSegmentNameForMap(mapName) {
		for (const s of this.worldMapSegments.values()) if (s.containsMap(mapName)) return s.name;
		return null;
	}
	toJSON(world) {
		const out = {};
		for (const m of this.predefinedMaps.values()) {
			if (m.visited || m.shouldSaveMapData(world)) out[m.name] = m.toJSON(world);
		}
		return out;
	}
	readJSON(o, world, controllers) {
		for (const [name, mo] of Object.entries(o)) {
			const m = this.predefinedMaps.get(name);
			if (m) m.readJSON(mo, world, controllers);
		}
	}
}

export class WorldMapSegment {
	constructor(name) { this.name = name; this.maps = new Map(); this.namedAreas = new Map(); }
	containsMap(mapName) { return this.maps.has(mapName); }
}

export const ColorFilterId = makeEnum('none', 'black20', 'black40', 'black60', 'black80', 'invert', 'bw', 'redtint', 'greentint', 'bluetint');

// MapLayer stores tiles column-major like Java: tiles[x][y]. We use flat Int32Array index x*h+y.
export class MapLayer {
	constructor(size) { this.w = size.width; this.h = size.height; this.tiles = new Int32Array(size.width * size.height); }
	get(x, y) { return this.tiles[x * this.h + y]; }
	setTile(type, x, y) { this.tiles[x * this.h + y] = type; }
}

export class MapSection {
	constructor(layerBase, layerGround, layerObjects, layerAbove, layerTop, isWalkable, layoutHash) {
		Object.assign(this, { layerBase, layerGround, layerObjects, layerAbove, layerTop, isWalkable, layoutHash });
	}
	// isWalkable: {w,h,data:Uint8Array} column-major
	replaceLayerContentsWith(src, area) {
		const full = this.isWalkable ? new Size(this.isWalkable.w, this.isWalkable.h) : null;
		const rep = (key, s) => {
			if (s == null) return;
			let dest = this[key];
			if (dest == null) { if (!full) return; dest = this[key] = new MapLayer(full); }
			for (let sx = 0, dx = area.topLeft.x; sx < area.size.width; ++sx, ++dx) {
				for (let y = 0; y < area.size.height; ++y) dest.tiles[dx * dest.h + area.topLeft.y + y] = s.tiles[sx * s.h + y];
			}
		};
		rep('layerBase', src.layerBase);
		rep('layerGround', src.layerGround);
		rep('layerObjects', src.layerObjects);
		rep('layerAbove', src.layerAbove);
		rep('layerTop', src.layerTop);
		if (src.isWalkable != null && this.isWalkable != null) {
			const d = this.isWalkable, s = src.isWalkable;
			for (let sx = 0, dx = area.topLeft.x; sx < area.size.width; ++sx, ++dx) {
				for (let y = 0; y < area.size.height; ++y) d.data[dx * d.h + area.topLeft.y + y] = s.data[sx * s.h + y];
			}
		}
		const len = Math.min(this.layoutHash.length, src.layoutHash.length);
		for (let i = 0; i < len; ++i) this.layoutHash[i] ^= src.layoutHash[i];
	}
	calculateHash(filter) {
		const hash = this.layoutHash.slice();
		if (filter != null) {
			const fb = new TextEncoder().encode(filter);
			const len = Math.min(hash.length, fb.length);
			for (let i = 0; i < len; ++i) hash[i] ^= fb[i];
		}
		let s = '';
		for (let i = 0; i < Math.min(4, hash.length); ++i) s += hash[i].toString(16).padStart(2, '0');
		return s;
	}
}

export class ReplaceableMapSection {
	constructor(replacementArea, replaceLayersWith, requirement, group) {
		this.isApplied = false;
		Object.assign(this, { replacementArea, replaceLayersWith, requirement, group });
	}
	apply(dest) { dest.replaceLayerContentsWith(this.replaceLayersWith, this.replacementArea); this.isApplied = true; }
}

export class LayeredTileMap {
	constructor(size, layout, replacements, colorFilter, usedTileIDs) {
		this.size = size;
		this.currentLayout = layout;
		this.replacements = replacements;
		this.originalColorFilter = colorFilter;
		this.colorFilter = colorFilter;
		this.usedTileIDs = usedTileIDs;
		this.currentLayoutHash = layout.calculateHash(colorFilter);
	}
	isWalkable(p, y) {
		if (p instanceof CoordRect) {
			for (let yy = 0; yy < p.size.height; ++yy)
				for (let xx = 0; xx < p.size.width; ++xx)
					if (!this.isWalkable(p.topLeft.x + xx, p.topLeft.y + yy)) return false;
			return true;
		}
		let x = p; if (typeof p !== 'number') { x = p.x; y = p.y; }
		if (this.isOutside(x, y)) return false;
		const w = this.currentLayout.isWalkable;
		if (!w) return true;
		return w.data[x * w.h + y] === 1;
	}
	isOutside(p, y) {
		if (p instanceof CoordRect) {
			if (this.isOutside(p.topLeft)) return true;
			if (p.topLeft.x + p.size.width > this.size.width) return true;
			if (p.topLeft.y + p.size.height > this.size.height) return true;
			return false;
		}
		let x = p; if (typeof p !== 'number') { x = p.x; y = p.y; }
		return x < 0 || y < 0 || x >= this.size.width || y >= this.size.height;
	}
	getCurrentLayoutHash() { return this.currentLayoutHash; }
	applyReplacement(r) {
		r.apply(this.currentLayout);
		this.currentLayoutHash = this.currentLayout.calculateHash(this.colorFilter === 'none' ? null : this.colorFilter);
	}
	changeColorFilter(id) {
		if (id == null) id = this.originalColorFilter;
		if (!ColorFilterId.values.includes(id)) return;
		if (this.colorFilter === id) return;
		this.colorFilter = id;
		this.currentLayoutHash = this.currentLayout.calculateHash(id === 'none' ? null : id);
	}
	// CSS filter / overlay for canvas rendering
	getCanvasFilter() {
		switch (this.colorFilter) {
			case 'invert': return 'invert(1)';
			case 'bw': return 'grayscale(1)';
			default: return 'none';
		}
	}
	getOverlayColor() {
		switch (this.colorFilter) {
			case 'black20': return 'rgba(0,0,0,0.2)';
			case 'black40': return 'rgba(0,0,0,0.4)';
			case 'black60': return 'rgba(0,0,0,0.6)';
			case 'black80': return 'rgba(0,0,0,0.8)';
			case 'redtint': return 'rgba(200,0,0,0.2)';
			case 'greentint': return 'rgba(0,200,0,0.2)';
			case 'bluetint': return 'rgba(0,0,200,0.2)';
			default: return null;
		}
	}
}
