// Ports of ItemEffectsView, AbilityModifierInfoView, ActorConditionEffectList, TraitsInfoView text logic.
import { getString as S } from '../strings.js';
import { Format } from '../util.js';
import { ActorCondition, Actor } from '../model.js';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function describeConditionEffect(e) {
	let sb;
	if (e.isImmunity()) sb = S('actorcondition_info_immunity', e.conditionType.name);
	else if (e.isRemovalEffect()) sb = S('actorcondition_info_removes_all', e.conditionType.name);
	else { sb = e.conditionType.name; if (e.magnitude > 1) sb += ' x' + e.magnitude; }
	if (ActorCondition.isTemporaryEffect(e.duration)) sb += ' ' + S('iteminfo_effect_duration', e.duration);
	if (!e.chance || e.chance.isMax()) return sb;
	return S('iteminfo_effect_chance_of', e.chance.toPercentString(), sb);
}
function condLinks(list) {
	return (list || []).filter((e) => e && e.conditionType).map((e) => `<a data-cond="${esc(e.conditionType.conditionTypeID)}">${esc(describeConditionEffect(e))}</a>`).join('');
}
export function describeStats(t) {
	const out = [];
	if (!t) return out;
	if (t.currentAPBoost) out.push(S(t.currentAPBoost.max > 0 ? 'iteminfo_effect_increase_current_ap' : 'iteminfo_effect_decrease_current_ap', t.currentAPBoost.toMinMaxAbsString()));
	if (t.currentHPBoost) out.push(S(t.currentHPBoost.max > 0 ? 'iteminfo_effect_increase_current_hp' : 'iteminfo_effect_decrease_current_hp', t.currentHPBoost.toMinMaxAbsString()));
	return out;
}
export function describeAbility(t, isWeapon) {
	const out = [];
	if (!t) return out;
	const nz = (v, inc, dec) => { if (v !== 0) out.push(S(v > 0 ? inc : dec, Math.abs(v))); };
	nz(t.increaseMaxHP, 'iteminfo_effect_increase_max_hp', 'iteminfo_effect_decrease_max_hp');
	nz(t.increaseMaxAP, 'iteminfo_effect_increase_max_ap', 'iteminfo_effect_decrease_max_ap');
	nz(t.increaseMoveCost, 'iteminfo_effect_increase_movecost', 'iteminfo_effect_decrease_movecost');
	nz(t.increaseUseItemCost, 'iteminfo_effect_increase_use_cost', 'iteminfo_effect_decrease_use_cost');
	nz(t.increaseReequipCost, 'iteminfo_effect_increase_reequip_cost', 'iteminfo_effect_decrease_reequip_cost');
	nz(t.increaseCriticalSkill, 'iteminfo_effect_increase_critical_skill', 'iteminfo_effect_decrease_critical_skill');
	nz(t.increaseBlockChance, 'iteminfo_effect_increase_block_chance', 'iteminfo_effect_decrease_block_chance');
	nz(t.increaseDamageResistance, 'iteminfo_effect_increase_damage_resistance', 'iteminfo_effect_decrease_damage_resistance');
	if (isWeapon) {
		out.push(S('iteminfo_effect_weapon_attack_cost', t.increaseAttackCost));
		nz(t.increaseAttackChance, 'iteminfo_effect_weapon_attack_chance', 'iteminfo_effect_decrease_attack_chance');
		if (t.setCriticalMultiplier !== 0) out.push(S('iteminfo_effect_critical_multiplier', Math.abs(t.setCriticalMultiplier)));
	} else {
		nz(t.increaseAttackCost, 'iteminfo_effect_increase_attack_cost', 'iteminfo_effect_decrease_attack_cost');
		nz(t.increaseAttackChance, 'iteminfo_effect_increase_attack_chance', 'iteminfo_effect_decrease_attack_chance');
	}
	if (t.increaseMinDamage !== 0 || t.increaseMaxDamage !== 0) {
		if (t.increaseMinDamage === t.increaseMaxDamage) {
			let l = 'iteminfo_effect_increase_attack_damage';
			if (t.increaseMinDamage < 0) l = 'iteminfo_effect_decrease_attack_damage'; else if (isWeapon) l = 'iteminfo_effect_weapon_attack_damage';
			out.push(S(l, Math.abs(t.increaseMinDamage)));
		} else {
			let l = 'iteminfo_effect_increase_attack_damage_minmax';
			if (t.increaseMinDamage < 0) l = 'iteminfo_effect_decrease_attack_damage_minmax'; else if (isWeapon) l = 'iteminfo_effect_weapon_attack_damage_minmax';
			out.push(S(l, Math.abs(t.increaseMinDamage), Math.abs(t.increaseMaxDamage)));
		}
	}
	if (isWeapon) out.push(S('iteminfo_effect_set_damage_modifier', t.setNonWeaponDamageModifier > 0 ? t.setNonWeaponDamageModifier : 100));
	return out;
}
const lines = (arr) => arr.map((s) => `<div>${esc(s)}</div>`).join('');
const head = (k) => `<div class="eh">${esc(S(k))}</div>`;

// Same sections as ItemEffectsView.update(...)
export function effectsHTML({ equip, use, hit, miss, kill, hitReceived, missReceived, death, isWeapon }) {
	let h = '';
	if (equip) {
		h += head('iteminfo_effect_works_when_equipped');
		if (equip.stats) h += lines(describeAbility(equip.stats, isWeapon));
		if (equip.addedConditions) h += condLinks(equip.addedConditions);
	}
	const onUse = (list, titleKey) => {
		if (!list || !list.length) return;
		h += head(titleKey);
		const src = [], tgt = [];
		for (const t of list) {
			if (t.addedConditions_source) src.push(...t.addedConditions_source);
			if (t.addedConditions_target) tgt.push(...t.addedConditions_target);
			if (t.changedStats) h += lines(describeStats(t.changedStats));
		}
		if (src.length) h += `<div class="eh">${esc(S('iteminfo_effect_works_on_source'))}</div>` + condLinks(src);
		if (tgt.length) h += `<div class="eh">${esc(S('iteminfo_effect_works_on_target'))}</div>` + condLinks(tgt);
	};
	const onRecv = (list, titleKey) => {
		if (!list || !list.length) return;
		h += head(titleKey);
		const src = [], tgt = [];
		let srcStats = '', tgtStats = '';
		for (const t of list) {
			if (t.addedConditions_source) src.push(...t.addedConditions_source);
			if (t.addedConditions_target) tgt.push(...t.addedConditions_target);
			if (t.changedStats) srcStats += lines(describeStats(t.changedStats));
			if (t.changedStats_target) tgtStats += lines(describeStats(t.changedStats_target));
		}
		if (src.length || srcStats) h += `<div class="eh">${esc(S('iteminfo_effect_works_on_source'))}</div>` + srcStats + condLinks(src);
		if (tgt.length || tgtStats) h += `<div class="eh">${esc(S('iteminfo_effect_works_on_attacker'))}</div>` + tgtStats + condLinks(tgt);
	};
	onUse(use, 'iteminfo_effect_works_when_used');
	onUse(hit, 'iteminfo_effect_works_when_hitting_target');
	onUse(miss, 'iteminfo_effect_works_when_missing_target');
	onUse(kill, 'iteminfo_effect_works_when_killing_target');
	onRecv(hitReceived, 'iteminfo_effect_works_when_hit_by_attacker');
	onRecv(missReceived, 'iteminfo_effect_works_when_missed_by_attacker');
	if (death) {
		h += head('iteminfo_effect_works_when_killed_by_attacker');
		h += lines(describeStats(death.changedStats));
		if (death.addedConditions_source) h += condLinks(death.addedConditions_source);
	}
	return h ? `<div class="effects">${h}</div>` : '';
}

const trim = (s) => s.replace(/:\s*$/, '');
export function traitsKV(a) {
	const rows = [];
	rows.push([trim(S('actorinfo_movecost')), S('general_ap_value', a.moveCost)]);
	rows.push([trim(S('traitsinfo_attack_cost')), S('general_ap_value', a.attackCost)]);
	rows.push([trim(S('traitsinfo_attack_chance')), String(a.attackChance)]);
	const dp = a.damagePotential;
	if (dp && dp.max !== 0) rows.push([trim(S('traitsinfo_attack_damage')), dp.isMax() ? S('general_hp_value', dp.max) : S('general_hp_minmax_value', dp.current, dp.max)]);
	if (a.criticalSkill !== 0) rows.push([trim(S('traitsinfo_criticalhit_skill')), String(a.criticalSkill)]);
	const cm = a.criticalMultiplier;
	if (cm !== 0 && cm !== 1) rows.push([trim(S('traitsinfo_criticalhit_multiplier')), S('general_multiplier_value', cm)]);
	if (a.criticalSkill !== 0 && cm !== 0 && cm !== 1) rows.push([trim(S('traitsinfo_criticalhit_effectivechance')), Format.localizePercentFromIntPercent(Actor.getEffectiveCriticalChance(a.criticalSkill))]);
	if (a.blockChance !== 0) rows.push([trim(S('traitsinfo_defense_chance')), String(a.blockChance)]);
	if (a.damageResistance !== 0) rows.push([trim(S('traitsinfo_defense_damageresist')), S('general_hp_value', a.damageResistance)]);
	if (a.immuneCrit) rows.push(['Immune to critical hits', 'Yes']);
	return '<dl class="kv">' + rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>';
}
export function actorTraitsKV(actor) {
	return traitsKV({ moveCost: actor.getMoveCost(), attackCost: actor.getAttackCost(), attackChance: actor.getAttackChance(),
		damagePotential: actor.getDamagePotential(), criticalSkill: actor.getCriticalSkill(), criticalMultiplier: actor.getCriticalMultiplier(),
		blockChance: actor.getBlockChance(), damageResistance: actor.getDamageResistance(), immuneCrit: actor.isImmuneToCriticalHits() });
}

// Skill name/description keys (SkillInfoActivity / SkillListAdapter)
const SKILL_KEY = {
	weaponChance: 'weapon_chance', weaponDmg: 'weapon_dmg', barter: 'barter', dodge: 'dodge', barkSkin: 'barkskin',
	moreCriticals: 'more_criticals', betterCriticals: 'better_criticals', speed: 'speed', coinfinder: 'coinfinder',
	moreExp: 'more_exp', cleave: 'cleave', eater: 'eater', fortitude: 'fortitude', evasion: 'evasion', regeneration: 'regeneration',
	lowerExploss: 'lower_exploss', magicfinder: 'magicfinder', resistanceMental: 'resistance_mental',
	resistancePhysical: 'resistance_physical_capacity', resistanceBlood: 'resistance_blood_disorder', shadowBless: 'shadow_bless',
	crit1: 'crit1', crit2: 'crit2', rejuvenation: 'rejuvenation', taunt: 'taunt', concussion: 'concussion',
	weaponProficiencyDagger: 'weapon_prof_dagger', weaponProficiency1hsword: 'weapon_prof_1hsword', weaponProficiency2hsword: 'weapon_prof_2hsword',
	weaponProficiencyAxe: 'weapon_prof_axe', weaponProficiencyBlunt: 'weapon_prof_blunt', weaponProficiencyUnarmed: 'weapon_prof_unarmed',
	armorProficiencyShield: 'armor_prof_shield', armorProficiencyUnarmored: 'armor_prof_unarmored', armorProficiencyLight: 'armor_prof_light',
	armorProficiencyHeavy: 'armor_prof_heavy', fightstyleDualWield: 'fightstyle_dualwield', fightstyle2hand: 'fightstyle_2hand',
	fightstyleWeaponShield: 'fightstyle_weapon_shield', fightstyleUnarmedUnarmored: 'fightstyle_unarmed_unarmored',
	specializationDualWield: 'specialization_dualwield', specialization2hand: 'specialization_2hand',
	specializationWeaponShield: 'specialization_weapon_shield', weaponProficiencyPole: 'weapon_prof_pole', sporeImmunity: 'spore_immunity',
};
export const skillTitle = (id) => S('skill_title_' + SKILL_KEY[id]);
export const skillShort = (id) => S('skill_shortdescription_' + SKILL_KEY[id]);
export function skillLong(id, SC) {
	const k = 'skill_longdescription_' + SKILL_KEY[id];
	const P = SC;
	const args = {
		weaponChance: [P.PER_SKILLPOINT_INCREASE_WEAPON_CHANCE], weaponDmg: [P.PER_SKILLPOINT_INCREASE_WEAPON_DAMAGE_MAX],
		barter: [P.PER_SKILLPOINT_INCREASE_BARTER_PRICEFACTOR_PERCENTAGE], dodge: [P.PER_SKILLPOINT_INCREASE_DODGE],
		barkSkin: [P.PER_SKILLPOINT_INCREASE_BARKSKIN], moreCriticals: [P.PER_SKILLPOINT_INCREASE_MORE_CRITICALS_PERCENT],
		betterCriticals: [P.PER_SKILLPOINT_INCREASE_BETTER_CRITICALS_PERCENT], speed: [P.PER_SKILLPOINT_INCREASE_SPEED],
		coinfinder: [P.PER_SKILLPOINT_INCREASE_COINFINDER_CHANCE_PERCENT, P.PER_SKILLPOINT_INCREASE_COINFINDER_QUANTITY_PERCENT],
		moreExp: [P.PER_SKILLPOINT_INCREASE_MORE_EXP_PERCENT], cleave: [P.PER_SKILLPOINT_INCREASE_CLEAVE_AP],
		eater: [P.PER_SKILLPOINT_INCREASE_EATER_HEALTH], fortitude: [P.PER_SKILLPOINT_INCREASE_FORTITUDE_HEALTH],
		evasion: [P.PER_SKILLPOINT_INCREASE_EVASION_FLEE_CHANCE_PERCENTAGE, P.PER_SKILLPOINT_INCREASE_EVASION_MONSTER_ATTACK_CHANCE_PERCENTAGE],
		regeneration: [P.PER_SKILLPOINT_INCREASE_REGENERATION], lowerExploss: [P.PER_SKILLPOINT_INCREASE_EXPLOSS_PERCENT, P.MAX_LEVEL_LOWER_EXPLOSS],
		magicfinder: [P.PER_SKILLPOINT_INCREASE_MAGICFINDER_CHANCE_PERCENT],
		resistanceMental: [P.PER_SKILLPOINT_INCREASE_RESISTANCE_CHANCE_PERCENT, P.PER_SKILLPOINT_INCREASE_RESISTANCE_CHANCE_PERCENT * P.MAX_LEVEL_RESISTANCE],
		resistancePhysical: [P.PER_SKILLPOINT_INCREASE_RESISTANCE_CHANCE_PERCENT, P.PER_SKILLPOINT_INCREASE_RESISTANCE_CHANCE_PERCENT * P.MAX_LEVEL_RESISTANCE],
		resistanceBlood: [P.PER_SKILLPOINT_INCREASE_RESISTANCE_CHANCE_PERCENT, P.PER_SKILLPOINT_INCREASE_RESISTANCE_CHANCE_PERCENT * P.MAX_LEVEL_RESISTANCE],
		shadowBless: [P.PER_SKILLPOINT_INCREASE_RESISTANCE_SHADOW_BLESS], sporeImmunity: [],
		crit1: [P.PER_SKILLPOINT_INCREASE_CRIT1_CHANCE], crit2: [P.PER_SKILLPOINT_INCREASE_CRIT2_CHANCE],
		rejuvenation: [P.PER_SKILLPOINT_INCREASE_REJUVENATION_CHANCE], taunt: [P.PER_SKILLPOINT_INCREASE_TAUNT_CHANCE, P.TAUNT_AP_LOSS],
		concussion: [P.CONCUSSION_THRESHOLD, P.PER_SKILLPOINT_INCREASE_CONCUSSION_CHANCE],
		weaponProficiencyUnarmed: [P.PER_SKILLPOINT_INCREASE_UNARMED_AC, P.PER_SKILLPOINT_INCREASE_UNARMED_DMG, P.PER_SKILLPOINT_INCREASE_UNARMED_BC],
		armorProficiencyShield: [P.PER_SKILLPOINT_INCREASE_SHIELD_PROF_DR], armorProficiencyUnarmored: [P.PER_SKILLPOINT_INCREASE_UNARMORED_BC],
		armorProficiencyLight: [P.PER_SKILLPOINT_INCREASE_LIGHT_ARMOR_BC_PERCENT],
		armorProficiencyHeavy: [P.PER_SKILLPOINT_INCREASE_HEAVY_ARMOR_BC_PERCENT, P.PER_SKILLPOINT_INCREASE_HEAVY_ARMOR_MOVECOST_PERCENT, P.PER_SKILLPOINT_INCREASE_HEAVY_ARMOR_ATKCOST_PERCENT, P.PER_SKILLPOINT_INCREASE_HEAVY_ARMOR_USECOST_PERCENT],
		fightstyleDualWield: [P.DUALWIELD_EFFICIENCY_LEVEL0, P.DUALWIELD_EFFICIENCY_LEVEL1, P.DUALWIELD_LEVEL1_OFFHAND_AP_COST_PERCENT, P.DUALWIELD_EFFICIENCY_LEVEL2],
		fightstyle2hand: [P.PER_SKILLPOINT_INCREASE_FIGHTSTYLE_2HAND_DMG_PERCENT],
		fightstyleWeaponShield: [P.PER_SKILLPOINT_INCREASE_FIGHTSTYLE_WEAPON_AC_PERCENT, P.PER_SKILLPOINT_INCREASE_FIGHTSTYLE_SHIELD_BC_PERCENT],
		fightstyleUnarmedUnarmored: [P.PER_SKILLPOINT_INCREASE_UNARMED_UNARMORED_AC, P.PER_SKILLPOINT_INCREASE_UNARMED_UNARMORED_BC, P.PER_SKILLPOINT_INCREASE_UNARMED_UNARMORED_DR, P.PER_SKILLPOINT_INCREASE_UNARMED_UNARMORED_DMG_MAX, P.PER_SKILLPOINT_INCREASE_UNARMED_UNARMORED_CM_PERCENT],
		specializationDualWield: [P.PER_SKILLPOINT_INCREASE_SPECIALIZATION_DUALWIELD_AC_PERCENT, P.PER_SKILLPOINT_INCREASE_SPECIALIZATION_DUALWIELD_BC_PERCENT],
		specialization2hand: [P.PER_SKILLPOINT_INCREASE_SPECIALIZATION_2HAND_DMG_PERCENT, P.PER_SKILLPOINT_INCREASE_SPECIALIZATION_2HAND_AC_PERCENT],
		specializationWeaponShield: [P.PER_SKILLPOINT_INCREASE_SPECIALIZATION_WEAPON_AC_PERCENT, P.PER_SKILLPOINT_INCREASE_SPECIALIZATION_WEAPON_DMG_PERCENT],
	}[id];
	const prof = [P.PER_SKILLPOINT_INCREASE_WEAPON_PROF_AC_PERCENT, P.PER_SKILLPOINT_INCREASE_WEAPON_PROF_BC_PERCENT, P.PER_SKILLPOINT_INCREASE_WEAPON_PROF_CS_PERCENT];
	return S(k, ...(args || prof));
}
const STAT_LABEL = { maxHP: 'actorinfo_health', maxAP: 'heroinfo_actionpoints', moveCost: 'actorinfo_movecost', attackCost: 'traitsinfo_attack_cost',
	attackChance: 'traitsinfo_attack_chance', criticalSkill: 'traitsinfo_criticalhit_skill', criticalMultiplier: 'traitsinfo_criticalhit_multiplier',
	damagePotentialMin: 'traitsinfo_attack_damage', damagePotentialMax: 'traitsinfo_attack_damage', blockChance: 'traitsinfo_defense_chance',
	damageResistance: 'traitsinfo_defense_damageresist' };
export function requirementText(req, value) {
	switch (req.requirementType) {
		case 'skillLevel': return S('skill_prerequisite_other_skill', value, skillTitle(req.skillOrStatID));
		case 'experienceLevel': return S('skill_prerequisite_level', value);
		case 'playerStat': return S('skill_prerequisite_stat', value, S(STAT_LABEL[req.skillOrStatID]).replace(':', ' ').trim());
	}
	return '';
}
export function difficultyText(controllers, monster) {
	const d = controllers.combatController.getMonsterDifficulty(monster);
	if (d >= 80) return S('monster_difficulty_veryeasy');
	if (d >= 60) return S('monster_difficulty_easy');
	if (d >= 40) return S('monster_difficulty_normal');
	if (d >= 20) return S('monster_difficulty_hard');
	if (d === 0) return S('monster_difficulty_impossible');
	return S('monster_difficulty_veryhard');
}
export function displayTypeText(t) {
	return { rare: S('iteminfo_displaytypes_rare'), extraordinary: S('iteminfo_displaytypes_extraordinary'), legendary: S('iteminfo_displaytypes_legendary'),
		ordinary: S('iteminfo_displaytypes_ordinary'), quest: S('iteminfo_displaytypes_quest') }[t.displayType] || '';
}
