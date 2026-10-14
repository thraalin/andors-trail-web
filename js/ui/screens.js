// Sheet-based ports of the Android activities and dialogs.
import { getString as S, getStringArray } from '../strings.js';
import { Format, Constants } from '../util.js';
import { SC, WearSlot, Inventory, ConversationCollection } from '../model.js';
import { TileManager } from '../resource/TileManager.js';
import { ConversationStatemachine } from '../controller/ConversationController.js';
import { ItemController } from '../controller/ItemController.js';
import { SkillController } from '../controller/SkillController.js';
import { BeginTurnAs } from '../controller/CombatController.js';
import { LevelUpSelection } from '../controller/ActorStatsController.js';
import { Savegames } from '../context.js';
import {
	esc, effectsHTML, actorTraitsKV, traitsKV, describeAbility, describeStats, skillTitle, skillShort, skillLong,
	requirementText, difficultyText, displayTypeText,
} from './describe.js';

const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const rarityClass = (t) => (t.displayType && t.displayType !== 'ordinary' ? ' r-' + t.displayType : '');

// ------------------------------------------------------------------ simple dialogs
export function showMessage(ui, title, text, onClose) {
	return ui.openSheet({ title, body: `<p>${esc(text).replace(/\n/g, '<br>')}</p>`, footer: [{ label: 'OK', primary: true }], onClose });
}
export function showConfirm(ui, title, text, yesLabel, onYes, noLabel = 'Cancel') {
	return ui.openSheet({ title, body: `<p>${esc(text).replace(/\n/g, '<br>')}</p>`,
		footer: [{ label: noLabel }, { label: yesLabel, primary: true, onClick: () => { setTimeout(onYes, 0); } }] });
}
export function showConfirmRest(ui, area) {
	let ok = false;
	ui.openSheet({
		title: S('dialog_rest_title'), body: `<p>${esc(S('dialog_rest_confirm_message'))}</p>`,
		footer: [{ label: 'No' }, { label: 'Yes', primary: true, onClick: () => { ok = true; } }],
		onClose: () => { if (ok) ui.controllers.mapController.rest(area); },
	});
}
export function showHeroDied(ui) {
	ui.openSheet({
		title: S('dialog_game_over_title'), body: `<p>${esc(S('dialog_game_over_text'))}</p>`, closable: false, scrimCloses: false,
		footer: [{ label: 'OK', primary: true }],
		onClose: () => { Savegames.deleteSlot(0); ui.exitToTitle(false); },
	});
}

// ------------------------------------------------------------------ conversation (ConversationActivity)
export function showConversation(ui, phraseID, npc, applyScriptEffectsForFirstPhrase) {
	const w = ui.world, player = w.model.player;
	let ending = null; // what to do after the sheet closes
	const sheet = ui.openSheet({
		title: npc ? npc.getName() : (player.getName()), sub: npc ? null : null,
		icon: ui.icon(npc ? npc.iconID : player.iconID, 36),
		body: '<div class="convo list"></div><div class="replies"></div>',
		scrimCloses: false,
		onClose: () => {
			ui.controllers.mapController.applyCurrentMapReplacements(true);
			if (ending) ending();
		},
	});
	const log = sheet.body.querySelector('.convo');
	const replies = sheet.body.querySelector('.replies');
	let newCount = 0;
	const add = (actor, text, cls) => {
		const line = document.createElement('div');
		line.className = 'line' + (cls ? ' ' + cls : '');
		if (actor) {
			line.appendChild(ui.icon(actor.iconID, 32));
			line.insertAdjacentHTML('beforeend', `<p><span class="who">${esc(actor.getName())}:</span> ${esc(text)}</p>`);
			if (actor === player) line.classList.add('player');
		} else {
			line.innerHTML = `<p>${esc(text)}</p>`;
		}
		log.appendChild(line);
		newCount++;
		requestAnimationFrame(() => { sheet.body.scrollTop = sheet.body.scrollHeight; });
	};
	const greyOld = () => { log.querySelectorAll('.line:not(.reward)').forEach((l) => l.classList.add('old')); };
	let canNext = false;
	const sm = new ConversationStatemachine(w, ui.controllers, {
		onTextPhraseReached: (message, actor) => { add(actor, message); },
		onScriptEffectsApplied: (r) => {
			for (const qp of r.questProgress) {
				const q = w.quests.getQuest(qp.questID);
				if (!q || !q.showInLog) continue;
				const e = q.getQuestLogEntry(qp.progress);
				add(null, S(e && e.finishesQuest ? 'conversation_reward_quest_finished' : 'conversation_reward_quest_updated', q.name).trim(), 'reward');
			}
			const loot = r.loot;
			if (loot.exp > 0) add(null, S('conversation_rewardexp', loot.exp).trim(), 'reward');
			if (loot.gold > 0) add(null, S('conversation_rewardgold', loot.gold).trim(), 'reward');
			else if (loot.gold < 0) add(null, S('conversation_lostgold', -loot.gold).trim(), 'reward');
			if (!loot.items.isEmpty()) {
				const n = loot.items.countItems();
				const names = loot.items.items.map((e) => e.itemType.getName(player) + (e.quantity > 1 ? ' ×' + e.quantity : '')).join(', ');
				add(null, (n === 1 ? S('conversation_rewarditem') : S('conversation_rewarditems', n)).trim() + ' ' + names, 'reward');
			}
			for (const s of r.skillIncrease) add(null, `[${skillTitle(s.id)} +1]`, 'reward');
			for (const c of r.actorConditions) if (c.conditionType) add(null, `[${c.conditionType.name}]`, 'reward');
			ui.updateAll();
		},
		onConversationEnded: () => { sheet.close(); },
		onConversationEndedWithShop: (m) => { ending = () => showShop(ui, m); sheet.close(); },
		onConversationEndedWithCombat: () => { sheet.close(); },
		onConversationEndedWithRemoval: () => { sheet.close(); },
		onConversationCanProceedWithNext: () => { canNext = true; },
		onConversationHasReply: (r, message) => { pending.push([r, message]); },
	});
	let pending = [];
	const render = () => {
		replies.innerHTML = '';
		if (sheet.closed) return;
		if (canNext) {
			sheet.setFooter([{ label: S('conversation_leave'), onClick: () => {} }, { label: S('conversation_next'), primary: true, keepOpen: true, onClick: () => step(() => sm.playerSelectedNextStep()) }]);
		} else {
			sheet.setFooter([{ label: S('conversation_leave') }]);
			pending.forEach(([r, msg], i) => {
				const b = document.createElement('button');
				b.textContent = msg;
				b.onclick = () => step(() => { add(player, msg, 'player'); sm.playerSelectedReply(r); });
				replies.appendChild(b);
			});
		}
		requestAnimationFrame(() => { sheet.body.scrollTop = sheet.body.scrollHeight; });
	};
	const step = (fn) => {
		greyOld();
		canNext = false; pending = [];
		fn();
		render();
	};
	sm.setCurrentNPC(npc);
	sm.proceedToPhrase(phraseID, applyScriptEffectsForFirstPhrase, true);
	if (!sheet.closed && log.children.length === 0 && !canNext && pending.length === 0) { sheet.close(); return; }
	render();
}

// ------------------------------------------------------------------ monsters
export function showMonsterEncounter(ui, m) {
	let attack = false;
	ui.openSheet({
		title: m.getName(), icon: ui.icon(m.iconID, 40),
		body: `<p>${esc(S('dialog_monsterencounter_message', difficultyText(ui.controllers, m))).replace(/\n/g, '<br>')}</p>`,
		footer: [
			{ label: S('dialog_monsterencounter_info'), keepOpen: true, onClick: () => showMonsterInfo(ui, m) },
			{ label: 'Cancel' },
			{ label: S('combat_attack', ui.world.model.player.getAttackCost()).replace(/ \(.*\)/, ''), primary: true, onClick: () => { attack = true; } },
		],
		onClose: () => {
			const cc = ui.controllers.combatController;
			if (attack) cc.enterCombat(BeginTurnAs.player);
			else cc.exitCombat(false, true);
		},
	});
}
export function showMonsterInfo(ui, m) {
	const w = ui.world;
	const body = `
		<p class="muted">${esc(S('actorinfo_difficulty'))} <b style="color:var(--parchment)">${esc(difficultyText(ui.controllers, m))}</b></p>
		<div class="meter hp" style="height:20px"><i style="width:${100 * m.health.current / Math.max(1, m.health.max)}%"></i><span style="line-height:18px">${esc(S('status_hp'))} ${m.health.current}/${m.health.max}</span></div>
		<dl class="kv"><dt>${esc(S('heroinfo_actionpoints').replace(/:$/, ''))}</dt><dd>${esc(S('general_ap_value', m.getMaxAP()))}</dd>
		<dt>Killed</dt><dd>${w.model.statistics.getNumberOfKillsForMonsterName(m.getName())}</dd></dl>
		<div class="h3">${esc(S('actorinfo_currenttraits'))}</div>
		${actorTraitsKV(m)}
		${conditionsBlock(m)}
		${effectsHTML({ hit: m.getOnHitEffectsAsList(), miss: m.getOnMissEffectsAsList(), hitReceived: m.getOnHitReceivedEffectsAsList(), missReceived: m.getOnMissReceivedEffectsAsList(), death: m.getOnDeathEffects() })}`;
	ui.openSheet({ title: m.getName(), icon: ui.icon(m.iconID, 40), body, footer: [{ label: S('dialog_close') }] });
}
function conditionsBlock(actor) {
	if (!actor.conditions.length && !actor.immunities.length) return '';
	const items = [...actor.conditions.map((c) => [c, false]), ...actor.immunities.map((c) => [c, true])].map(([c, imm]) => {
		let s = imm ? S('actorcondition_info_immunity', c.conditionType.name) : c.conditionType.name + (c.magnitude > 1 ? ' x' + c.magnitude : '');
		if (c.isTemporaryEffect()) s += ' ' + S('iteminfo_effect_duration', c.duration);
		return `<a data-cond="${esc(c.conditionType.conditionTypeID)}">${esc(s)}</a>`;
	}).join('');
	return `<div class="h3">${esc(S('actorinfo_currentconditions'))}</div><div class="effects">${items}</div>`;
}

// ------------------------------------------------------------------ loot (Dialogs.showLoot)
export function showLoot(ui, title, msg, combinedLoot, bags) {
	const w = ui.world, player = w.model.player, ic = ui.controllers.itemController;
	const sheet = ui.openSheet({
		title, icon: ui.icon(TileManager.iconID_groundbag, 32), body: '',
		onClose: () => { ic.removeLootBagIfEmpty(bags); ui.updateAll(); },
	});
	const render = () => {
		let html = `<p>${esc(msg)}</p>`;
		if (!combinedLoot.items.isEmpty()) html += '<div class="list" id="lootList"></div><p class="note">Tap an item to take it.</p>';
		sheet.setBody(html);
		const list = sheet.body.querySelector('#lootList');
		if (list) for (const e of combinedLoot.items.items) {
			const b = h(`<button class="item"><span class="t${rarityClass(e.itemType)}">${esc(ItemController.describeItemForListView(e, player))}</span></button>`);
			b.prepend(ui.itemIcon(e.itemType));
			b.onclick = () => {
				const id = e.itemType.id;
				let removeFromCombined = true;
				for (const l of bags) {
					if (l === combinedLoot) removeFromCombined = false;
					if (l.items.removeItem(id)) { ic.removeLootBagIfEmpty(l); break; }
				}
				if (removeFromCombined) combinedLoot.items.removeItem(id);
				player.inventory.addItem(w.itemTypes.getItemType(id));
				ui.updateAll();
				if (combinedLoot.items.isEmpty()) sheet.close(); else render();
			};
			list.appendChild(b);
		}
		const footer = [];
		if (!combinedLoot.items.isEmpty()) footer.push({ label: S('dialog_loot_pickall'), primary: true, onClick: () => { ic.pickupAll(bags); } });
		footer.unshift({ label: S('dialog_close') });
		sheet.setFooter(footer);
	};
	render();
}

// ------------------------------------------------------------------ hero info (HeroinfoActivity + fragments)
export function showHeroInfo(ui, tab = 'overview') {
	const p = ui.world.model.player;
	const sheet = ui.openSheet({
		title: p.getName(), sub: `Level ${p.level}`, icon: ui.icon(p.iconID, 36), full: true,
		tabs: [
			{ id: 'overview', label: S('heroinfo_char'), render: (s) => renderOverview(ui, s) },
			{ id: 'items', label: S('heroinfo_inv'), render: (s) => renderInventory(ui, s) },
			{ id: 'quests', label: S('heroinfo_quests'), render: (s) => renderQuests(ui, s) },
			{ id: 'skills', label: S('heroinfo_skill'), render: (s) => renderSkills(ui, s) },
		],
	});
	sheet.rerender = () => sheet.selectTab(sheet.tab);
	sheet.selectTab(tab);
	return sheet;
}
function meter(cls, label, cur, max) {
	return `<div class="meter ${cls}" style="height:20px"><i style="width:${100 * Math.min(1, Math.max(0, cur) / Math.max(1, max))}%"></i><span style="line-height:18px">${esc(label)} ${Format.localizeInt(cur)}/${Format.localizeInt(max)}</span></div>`;
}
function renderOverview(ui, sheet) {
	const w = ui.world, p = w.model.player, st = w.model.statistics;
	let mode;
	if (st.hasUnlimitedLives() && st.hasUnlimitedSaves()) mode = S('heroinfo_unlimited_lives_and_saves').replace('\n', ' ');
	else if (st.hasUnlimitedLives()) mode = S('heroinfo_unlimited_lives');
	else if (st.getStartLives() === 1) mode = S('heroinfo_one_life');
	else mode = S('heroinfo_limited_lives', st.getLivesLeft(), st.getStartLives());
	const wornEff = { hit: [], miss: [], kill: [], hitReceived: [], missReceived: [] };
	for (const slot of WearSlot.values) {
		const t = p.inventory.getItemTypeInWearSlot(slot);
		if (!t) continue;
		if (t.effects_hit) wornEff.hit.push(t.effects_hit);
		if (t.effects_miss) wornEff.miss.push(t.effects_miss);
		if (t.effects_kill) wornEff.kill.push(t.effects_kill);
		if (t.effects_hitReceived) wornEff.hitReceived.push(t.effects_hitReceived);
		if (t.effects_missReceived) wornEff.missReceived.push(t.effects_missReceived);
	}
	const b = p.baseTraits;
	const stat = (label, v) => (v ? `<dt>${esc(label)}</dt><dd>${esc(v)}</dd>` : '');
	const levelBtn = p.canLevelup() ? `<button class="btn primary" id="lvlUp">${esc(S('heroinfo_levelup'))}</button>` : '';
	const sp = p.availableSkillIncreases > 0 ? `<button class="btn" id="toSkills">${esc(p.availableSkillIncreases === 1 ? S('skill_number_of_increases_one') : S('skill_number_of_increases_several', p.availableSkillIncreases))}</button>` : '';
	sheet.setBody(`
		${levelBtn}${sp}
		<div class="list">${meter('hp', S('heroinfo_healthpoints'), p.health.current, p.health.max)}
		${meter('xp', S('heroinfo_experiencepoints'), p.levelExperience.current, p.levelExperience.max)}
		${meter('ap', S('heroinfo_actionpoints'), p.ap.current, p.ap.max)}</div>
		<dl class="kv"><dt>${esc(S('heroinfo_level'))}</dt><dd>${p.level}</dd><dt>${esc(S('heroinfo_totalexperience'))}</dt><dd>${Format.localizeInt(p.totalExperience)}</dd>
		<dt>${esc(S('heroinfo_mode'))}</dt><dd>${esc(mode)}</dd><dt>Gold</dt><dd>${Format.localizeInt(p.inventory.gold)}</dd>
		<dt>Re-equip cost</dt><dd>${esc(S('general_ap_value', p.getReequipCost()))}</dd><dt>Use item cost</dt><dd>${esc(S('general_ap_value', p.getUseItemCost()))}</dd></dl>
		<div class="h3">${esc(S('actorinfo_currenttraits'))}</div>
		${actorTraitsKV(p)}
		${conditionsBlock(p)}
		${effectsHTML(Object.fromEntries(Object.entries(wornEff).map(([k, v]) => [k, v.length ? v : null])))}
		<div class="h3">${esc(S('actorinfo_basetraits'))}</div>
		<dl class="kv"><dt>Max HP</dt><dd>${esc(S('general_hp_value', b.maxHP))}</dd><dt>Max AP</dt><dd>${esc(S('general_ap_value', b.maxAP))}</dd></dl>
		${traitsKV({ moveCost: b.moveCost, attackCost: b.attackCost, attackChance: b.attackChance, damagePotential: b.damagePotential, criticalSkill: b.criticalSkill, criticalMultiplier: b.criticalMultiplier, blockChance: b.blockChance, damageResistance: b.damageResistance })}
		<div class="h3">Statistics</div>
		<dl class="kv">
			${stat('Quests completed', st.getNumberOfCompletedQuests(w) || '')}
			${stat('Places visited', st.getNumberOfVisitedMaps(w) || '')}
			${stat('Monsters killed', st.getNumberOfKilledMonsters() || '')}
			${stat('Deaths', st.getDeaths() || '')}
			${stat('Gold spent', st.getSpentGold() ? Format.localizeInt(st.getSpentGold()) : '')}
			${stat('Items used', st.getNumberOfUsedItems() || '')}
			${stat('Most used item', st.getMostCommonlyUsedItem(w) || '')}
			${stat('Toughest kill', st.getMostPowerfulKilledMonster(w) || '')}
		</dl>`);
	const lb = sheet.body.querySelector('#lvlUp');
	if (lb) lb.onclick = () => showLevelUp(ui, () => { sheet.rerender(); ui.updateAll(); });
	const ts = sheet.body.querySelector('#toSkills');
	if (ts) ts.onclick = () => sheet.selectTab('skills');
}

const CAT_KEYS = ['all', 'weapons', 'armor', 'jewelry', 'potion', 'food', 'quest', 'other'];
const SORTS = ['custom', 'name', 'price', 'quantity', 'rarity', 'type'];
function suggestInventorySlot(p, t) {
	let slot = t.category.inventorySlot;
	if (p.inventory.isEmptySlot(slot)) return slot;
	if (slot === 'leftring') return 'rightring';
	if (t.isOffhandCapableWeapon()) {
		const main = p.inventory.getItemTypeInWearSlot('weapon');
		if (main != null && main.isTwohandWeapon()) return slot;
		if (p.inventory.isEmptySlot('shield')) return 'shield';
	}
	return slot;
}
function renderInventory(ui, sheet) {
	const w = ui.world, p = w.model.player, inv = p.inventory, sel = w.model.uiSelections;
	const dp = p.getDamagePotential();
	const dmg = dp.current === dp.max ? `${dp.max}` : `${dp.current}–${dp.max}`;
	let atk = `AC ${p.getAttackChance()} · damage ${dmg}`;
	if (p.getCriticalSkill()) atk += ` · CS ${p.getCriticalSkill()}`;
	if (p.getCriticalMultiplier() && p.getCriticalMultiplier() !== 1) atk += ` ×${Format.localizeFloat(p.getCriticalMultiplier(), 1)}`;
	let def = `BC ${p.getBlockChance()}`;
	if (p.getDamageResistance()) def += ` · DR ${p.getDamageResistance()}`;
	const slotImg = { weapon: 'equip_weapon', shield: 'equip_shield', head: 'equip_head', body: 'equip_body', hand: 'equip_hand', feet: 'equip_feet', neck: 'equip_neck', leftring: 'equip_ring', rightring: 'equip_ring' };
	const slotName = { weapon: 'Weapon', shield: 'Off-hand', head: 'Head', body: 'Body', hand: 'Hands', feet: 'Feet', neck: 'Neck', leftring: 'Ring', rightring: 'Ring' };
	const cats = getStringArray('inventorylist_category_filters');
	const sorts = getStringArray('inventorylist_sort_filters');
	sheet.setBody(`
		<dl class="kv"><dt>Gold</dt><dd>${Format.localizeInt(inv.gold)}</dd><dt>${esc(S('actorinfo_attack'))}</dt><dd>${esc(atk)}</dd><dt>${esc(S('actorinfo_defense'))}</dt><dd>${esc(def)}</dd></dl>
		<div class="h3">${esc(S('heroinfo_wornequipment'))}</div>
		<div class="wear" id="wear"></div>
		<div class="h3">${esc(S('heroinfo_inventory'))}</div>
		<div class="chips" id="cats"></div>
		<div class="chips" id="sorts" style="margin-top:-4px"></div>
		<div class="list" id="invList"></div>`);
	const wear = sheet.body.querySelector('#wear');
	for (const slot of ['head', 'neck', 'body', 'weapon', 'hand', 'shield', 'leftring', 'feet', 'rightring']) {
		const t = inv.getItemTypeInWearSlot(slot);
		const b = h(`<button class="${t ? 'on' : ''}"><span>${esc(t ? t.getName(p) : slotName[slot])}</span></button>`);
		if (t) b.prepend(ui.itemIcon(t, 32)); else b.prepend(h(`<img src="data/img/${slotImg[slot]}.png" alt="">`));
		b.onclick = () => {
			if (!t) return;
			const inCombat = sel.isInCombat, ap = p.getReequipCost();
			showItemInfo(ui, t, {
				buttonText: inCombat ? S('iteminfo_action_unequip_ap', ap) : S('iteminfo_action_unequip'),
				enabled: !inCombat || ap <= 0 || p.hasAPs(ap),
				onAction: () => { ui.controllers.itemController.unequipSlot(t, slot); sheet.rerender(); },
			});
		};
		wear.appendChild(b);
	}
	const chips = (id, labels, get, set) => {
		const box = sheet.body.querySelector(id);
		labels.forEach((l, i) => {
			const b = h(`<button aria-pressed="${get() === i}">${esc(l)}</button>`);
			b.onclick = () => { set(i); sheet.rerender(); };
			box.appendChild(b);
		});
	};
	chips('#cats', cats.length ? cats : CAT_KEYS, () => sel.selectedInventoryCategory, (i) => { sel.selectedInventoryCategory = i; });
	chips('#sorts', sorts.length ? sorts : SORTS, () => sel.selectedInventorySort, (i) => {
		sel.selectedInventorySort = i;
		const k = SORTS[i];
		if (k === 'name') inv.sortByName(p); else if (k === 'price') inv.sortByPrice(p); else if (k === 'quantity') inv.sortByQuantity(p);
		else if (k === 'rarity') inv.sortByRarity(p); else if (k === 'type') inv.sortByType(p);
	});
	const builders = [null, 'buildWeaponItems', 'buildArmorItems', 'buildJewelryItems', 'buildPotionItems', 'buildFoodItems', 'buildQuestItems', 'buildOtherItems'];
	const c = sel.selectedInventoryCategory;
	const items = c ? inv[builders[c]]().items : inv.items;
	const list = sheet.body.querySelector('#invList');
	if (!items.length) list.innerHTML = '<p class="muted">Nothing here.</p>';
	for (const e of items) {
		const b = h(`<button class="item"><span class="t${rarityClass(e.itemType)}">${esc(ItemController.describeItemForListView(e, p))}</span></button>`);
		b.prepend(ui.itemIcon(e.itemType));
		b.onclick = () => showInventoryItemInfo(ui, e.itemType, () => sheet.rerender());
		list.appendChild(b);
	}
}
function showInventoryItemInfo(ui, t, refresh) {
	const p = ui.world.model.player, inCombat = ui.world.model.uiSelections.isInCombat;
	let text = '', ap = 0, action = null;
	if (t.isEquippable()) { ap = p.getReequipCost(); text = inCombat ? S('iteminfo_action_equip_ap', ap) : S('iteminfo_action_equip'); action = 'equip'; }
	else if (t.isUsable()) { ap = p.getUseItemCost(); text = inCombat ? S('iteminfo_action_use_ap', ap) : S('iteminfo_action_use'); action = 'use'; }
	showItemInfo(ui, t, {
		buttonText: text, enabled: !(inCombat && ap > 0) || p.hasAPs(ap),
		onAction: () => {
			if (action === 'equip') ui.controllers.itemController.equipItem(t, suggestInventorySlot(p, t));
			else if (action === 'use') ui.controllers.itemController.useItem(t);
			refresh();
		},
		more: () => showItemActions(ui, t, refresh),
	});
}
function showItemActions(ui, t, refresh) {
	const p = ui.world.model.player, ic = ui.controllers.itemController;
	const acts = [];
	if (t.isUsable()) {
		acts.push([S('inventory_use'), () => ic.useItem(t)]);
		for (let i = 0; i < 3; i++) acts.push([`${S('inventory_assign')}: ${S('inventory_assign_slot' + (i + 1))}`, () => ic.setQuickItem(t, i)]);
	}
	if (t.isEquippable()) {
		acts.push([S('inventory_equip'), () => ic.equipItem(t, t.category.inventorySlot)]);
		if (t.isOffhandCapableWeapon()) acts.push([S('inventory_equip') + ' (off-hand)', () => ic.equipItem(t, 'shield')]);
		else if (t.category.inventorySlot === 'leftring') acts.push([S('inventory_equip') + ' (right hand)', () => ic.equipItem(t, 'rightring')]);
	}
	acts.push(['Move to top', () => p.inventory.sortToTop(t.id)]);
	acts.push(['Move to bottom', () => p.inventory.sortToBottom(t.id)]);
	acts.push([S('inventory_drop'), () => {
		const q = p.inventory.getItemQuantity(t.id);
		if (q > 1) setTimeout(() => showBulk(ui, t, q, 'drop', (n) => { ic.dropItem(t, n); refresh(); }), 0);
		else ic.dropItem(t, q);
	}]);
	const sheet = ui.openSheet({ title: t.getName(p), icon: ui.itemIcon(t, 36), body: '<div class="list"></div>', footer: [{ label: S('dialog_close') }] });
	const list = sheet.body.querySelector('.list');
	for (const [label, fn] of acts) {
		const b = h(`<button class="item"><span class="t">${esc(label)}</span></button>`);
		b.onclick = () => { fn(); sheet.close(); refresh(); ui.updateAll(); };
		list.appendChild(b);
	}
}
// ItemInfoActivity
export function showItemInfo(ui, t, { buttonText, enabled = true, onAction, more } = {}) {
	const p = ui.world.model.player;
	const desc = t.getDescription();
	const dt = t.isOrdinaryItem() ? '' : `<p class="${rarityClass(t)}">${esc(displayTypeText(t))}</p>`;
	const body = `${dt}
		${desc ? `<p>${esc(desc.split(Constants.PLACEHOLDER_PLAYERNAME).join(p.getName()))}</p>` : ''}
		<dl class="kv"><dt>${esc(S('iteminfo_category').trim())}</dt><dd>${esc(t.category ? t.category.displayName : '')}</dd>
		${t.baseMarketCost > 0 && !t.isQuestItem() ? `<dt>Value</dt><dd>${Format.localizeInt(t.baseMarketCost)} gold</dd>` : ''}</dl>
		${effectsHTML({ equip: t.effects_equip, use: t.effects_use ? [t.effects_use] : null, hit: t.effects_hit ? [t.effects_hit] : null, miss: t.effects_miss ? [t.effects_miss] : null, kill: t.effects_kill ? [t.effects_kill] : null, hitReceived: t.effects_hitReceived ? [t.effects_hitReceived] : null, missReceived: t.effects_missReceived ? [t.effects_missReceived] : null, isWeapon: t.isWeapon() })}`;
	const footer = [{ label: S('dialog_close') }];
	if (more) footer.push({ label: S('dialog_more'), onClick: () => setTimeout(more, 0) });
	if (buttonText) footer.push({ label: buttonText, primary: true, disabled: !enabled, onClick: () => { if (onAction) setTimeout(onAction, 0); } });
	return ui.openSheet({ title: t.getName(p), icon: ui.itemIcon(t, 40), body, footer });
}
// BulkSelectionInterface
export function showBulk(ui, t, max, mode, onConfirm, unitPrice = 0) {
	const p = ui.world.model.player;
	let n = Math.min(1, max);
	const title = { buy: S('shop_buy'), sell: S('shop_sell'), drop: S('inventory_drop') }[mode];
	const sheet = ui.openSheet({
		title: `${title}: ${t.getName(p)}`, icon: ui.itemIcon(t, 36),
		body: `<div class="qty"><input type="range" id="bulkQty" min="1" max="${max}" value="1" aria-label="Quantity"><output id="bulkOut">1</output></div>
			<div class="row"><button class="btn small" data-d="-10">−10</button><button class="btn small" data-d="-1">−1</button><button class="btn small" data-d="1">+1</button><button class="btn small" data-d="10">+10</button><button class="btn small" data-d="all">${esc(S('bulkselection_select_all'))}</button></div>
			${unitPrice ? '<p id="bulkCost" class="muted"></p>' : ''}`,
	});
	const range = sheet.body.querySelector('#bulkQty'), out = sheet.body.querySelector('#bulkOut'), cost = sheet.body.querySelector('#bulkCost');
	const set = (v) => {
		n = Math.max(1, Math.min(max, v));
		range.value = n; out.textContent = n;
		if (cost) cost.textContent = S(mode === 'buy' ? 'bulkselection_totalcost_buy' : 'bulkselection_totalcost_sell', unitPrice * n);
		sheet.setFooter([{ label: 'Cancel' }, { label: `${title} ${n}`, primary: true, disabled: mode === 'buy' && unitPrice * n > p.inventory.gold, onClick: () => setTimeout(() => onConfirm(n), 0) }]);
	};
	range.oninput = () => set(parseInt(range.value, 10));
	sheet.body.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => set(b.dataset.d === 'all' ? max : n + parseInt(b.dataset.d, 10)); });
	set(n);
}
// quick slot assignment
export function showQuickslotAssign(ui, slot) {
	const w = ui.world, p = w.model.player;
	const usable = p.inventory.usableItems();
	const sheet = ui.openSheet({ title: `${S('inventory_assign')} ${slot + 1}`, sub: S('inventory_selectitem'), body: '<div class="list"></div>' });
	const list = sheet.body.querySelector('.list');
	if (p.inventory.quickitem[slot]) {
		const b = h(`<button class="item"><span class="t">${esc(S('inventory_unassign'))}</span></button>`);
		b.onclick = () => { ui.controllers.itemController.setQuickItem(null, slot); sheet.close(); };
		list.appendChild(b);
	}
	if (usable.isEmpty()) list.insertAdjacentHTML('beforeend', '<p class="muted">You have no usable items yet. Potions and food can be assigned here.</p>');
	for (const e of usable.items) {
		const b = h(`<button class="item"><span class="t${rarityClass(e.itemType)}">${esc(ItemController.describeItemForListView(e, p))}</span></button>`);
		b.prepend(ui.itemIcon(e.itemType));
		b.onclick = () => { ui.controllers.itemController.setQuickItem(e.itemType, slot); sheet.close(); };
		list.appendChild(b);
	}
}

// ------------------------------------------------------------------ quests
function renderQuests(ui, sheet) {
	const w = ui.world, p = w.model.player, sel = w.model.uiSelections;
	const filters = getStringArray('questlog_includecompleted');
	let html = '<div class="chips" id="qf"></div><div class="list" id="ql"></div>';
	sheet.setBody(html);
	const qf = sheet.body.querySelector('#qf');
	filters.forEach((l, i) => {
		const b = h(`<button aria-pressed="${sel.selectedQuestFilter === i}">${esc(l)}</button>`);
		b.onclick = () => { sel.selectedQuestFilter = i; sheet.rerender(); };
		qf.appendChild(b);
	});
	const ql = sheet.body.querySelector('#ql');
	let any = false;
	for (const id of p.getAllQuestProgressIDs()) {
		const q = w.quests.getQuest(id);
		if (!q || !q.showInLog) continue;
		const done = q.isCompleted(p);
		const v = sel.selectedQuestFilter;
		if (v === 0 && done) continue;
		if (v === 2 && !done) continue;
		any = true;
		const entries = [];
		for (const prog of p.getQuestProgress(q.questID)) for (const e of q.stages) if (e.progress === prog && e.logtext && e.logtext.length) entries.push(e.logtext);
		const d = h(`<details class="quest"><summary><span>${esc(q.name)}</span>${done ? `<span class="done">✔ ${esc(S('questlog_queststatus_completed'))}</span>` : ''}</summary><ul>${entries.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>`);
		ql.appendChild(d);
	}
	if (!any) ql.innerHTML = '<p class="muted">No quests to show.</p>';
	const first = ql.querySelector('details');
	if (first && sel.selectedQuestFilter === 0) first.open = true;
}

// ------------------------------------------------------------------ skills
function renderSkills(ui, sheet) {
	const w = ui.world, p = w.model.player;
	const skills = w.skills.getAllSkills().filter((s) => p.hasSkill(s.id) || s.levelupVisibility === 'alwaysShown');
	let head = p.availableSkillIncreases > 0
		? `<p style="color:var(--reward)">${esc(p.availableSkillIncreases === 1 ? S('skill_number_of_increases_one') : S('skill_number_of_increases_several', p.availableSkillIncreases))}</p>`
		: '<p class="muted">You earn a skill point every 4 levels (from level 4). Tap a skill to read about it.</p>';
	sheet.setBody(head + '<div class="list" id="sl"></div>');
	const sl = sheet.body.querySelector('#sl');
	for (const s of skills) {
		const lvl = p.getSkillLevel(s.id);
		const enabled = p.hasAvailableSkillpoints() ? SkillController.canLevelupSkillManually(p, s) : p.hasSkill(s.id);
		const b = h(`<button class="item${enabled ? '' : ' off'}"><span class="t">${esc(skillTitle(s.id))}${lvl > 0 ? ` (${lvl})` : ''}<small>${esc(skillShort(s.id))}</small></span></button>`);
		b.prepend(h('<img src="data/img/ui_icon_skill.png" alt="" style="width:28px;height:28px;image-rendering:pixelated">'));
		b.onclick = () => showSkillInfo(ui, s, () => sheet.rerender());
		sl.appendChild(b);
	}
}
export function showSkillInfo(ui, skill, refresh) {
	const p = ui.world.model.player;
	const lvl = p.getSkillLevel(skill.id), next = lvl + 1;
	let cur = '';
	if (skill.hasMaxLevel()) cur = S('skill_current_level_with_maximum', lvl, skill.maxLevel);
	else if (p.hasSkill(skill.id)) cur = S('skill_current_level', lvl);
	let reqs = '';
	if (skill.hasLevelupRequirements() && (!skill.hasMaxLevel() || lvl < skill.maxLevel)) {
		reqs = '<div class="effects">' + skill.levelupRequirements.map((r) => {
			const ok = r.isSatisfiedByPlayer(p, next);
			return `<div style="color:${ok ? 'var(--muted)' : 'var(--hp)'}">${ok ? '✓' : '✗'} ${esc(requirementText(r, r.getRequiredValue(next)))}</div>`;
		}).join('') + '</div>';
	}
	ui.openSheet({
		title: skillTitle(skill.id), body: `<p>${esc(skillLong(skill.id, SC))}</p>${cur ? `<p class="muted">${esc(cur)}</p>` : ''}${reqs}`,
		footer: [{ label: S('dialog_close') }, { label: S('skillinfo_action_levelup'), primary: true, disabled: !SkillController.canLevelupSkillManually(p, skill),
			onClick: () => { ui.controllers.skillController.levelUpSkillManually(p, skill); refresh && refresh(); ui.updateAll(); } }],
	});
}
// LevelUpActivity
export function showLevelUp(ui, after) {
	const p = ui.world.model.player;
	if (!p.canLevelup()) return;
	const opt = (sel, key, val, descKey) => ({ sel, label: S(key, val), desc: S(descKey, val) });
	const opts = [
		opt(LevelUpSelection.health, 'levelup_add_health', Constants.LEVELUP_EFFECT_HEALTH, 'levelup_add_health_description'),
		opt(LevelUpSelection.attackChance, 'levelup_add_attackchance', Constants.LEVELUP_EFFECT_ATK_CH, 'levelup_add_attackchance_description'),
		opt(LevelUpSelection.attackDamage, 'levelup_add_attackdamage', Constants.LEVELUP_EFFECT_ATK_DMG, 'levelup_add_attackdamage_description'),
		opt(LevelUpSelection.blockChance, 'levelup_add_blockchance', Constants.LEVELUP_EFFECT_DEF_CH, 'levelup_add_blockchance_description'),
	];
	const sheet = ui.openSheet({
		title: S('levelup_title'), icon: ui.icon(p.iconID, 36),
		body: `<p>${esc(S('levelup_description', p.level + 1))}</p>${p.nextLevelAddsNewSkillpoint() ? `<p style="color:var(--reward)">${esc(S('levelup_adds_new_skillpoint'))}</p>` : ''}<div class="list"></div>`,
		onClose: after,
	});
	const list = sheet.body.querySelector('.list');
	for (const o of opts) {
		const b = h(`<button class="item"><span class="t">${esc(o.label)}<small>${esc(o.desc)}</small></span></button>`);
		b.onclick = () => { ui.controllers.actorStatsController.addLevelupEffect(p, o.sel); sheet.close(); if (p.canLevelup()) setTimeout(() => showLevelUp(ui, after), 0); };
		list.appendChild(b);
	}
}
// ActorConditionInfoActivity
export function showConditionInfo(ui, t) {
	const cat = { physical: 'actorcondition_categories_physical', mental: 'actorcondition_categories_mental', blood: 'actorcondition_categories_blood', spiritual: 'actorcondition_categories_spiritual' }[t.conditionCategory];
	let body = t.description ? `<p>${esc(t.description)}</p>` : '';
	body += `<p class="muted">${esc(S('actorconditioninfo_category', S(cat)))}</p><div class="effects">`;
	if (t.abilityEffect) body += `<div class="eh">${esc(S('actorconditioninfo_constant_effect'))}</div>` + describeAbility(t.abilityEffect, false).map((s) => `<div>${esc(s)}</div>`).join('');
	if (t.statsEffect_everyRound) body += `<div class="eh">${esc(S('actorconditioninfo_effect_every_round'))}</div>` + describeStats(t.statsEffect_everyRound).map((s) => `<div>${esc(s)}</div>`).join('');
	if (t.statsEffect_everyFullRound) body += `<div class="eh">${esc(S('actorconditioninfo_effect_every_full_round'))}</div>` + describeStats(t.statsEffect_everyFullRound).map((s) => `<div>${esc(s)}</div>`).join('');
	body += '</div>';
	ui.openSheet({ title: t.name, icon: ui.icon(t.iconID, 32), body, footer: [{ label: S('dialog_close') }] });
}

// ------------------------------------------------------------------ shop (ShopActivity)
export function showShop(ui, npc) {
	const w = ui.world, p = w.model.player;
	if (!npc || !npc.getDropList()) return;
	const shopInv = npc.getShopItems(p);
	const sheet = ui.openSheet({
		title: npc.getName(), icon: ui.icon(npc.iconID, 36), full: true,
		tabs: [
			{ id: 'buy', label: S('shop_buy'), render: (s) => renderShopTab(ui, s, shopInv, false) },
			{ id: 'sell', label: S('shop_sell'), render: (s) => renderShopTab(ui, s, shopInv, true) },
		],
		footer: [{ label: S('dialog_close') }],
	});
	sheet.rerender = () => sheet.selectTab(sheet.tab);
	sheet.selectTab('buy');
}
function renderShopTab(ui, sheet, shopInv, selling) {
	const w = ui.world, p = w.model.player;
	const container = selling ? p.inventory : shopInv;
	sheet.setBody(`<p style="color:var(--reward)">${esc(S('shop_yourgold', p.getGold()))}</p><div class="list"></div>`);
	const list = sheet.body.querySelector('.list');
	const entries = container.items.filter((e) => !selling || e.itemType.isSellable());
	if (!entries.length) list.innerHTML = `<p class="muted">${selling ? 'You have nothing this merchant will buy.' : 'Sold out.'}</p>`;
	for (const e of entries) {
		const t = e.itemType;
		const price = selling ? ItemController.getSellingPrice(p, t) : ItemController.getBuyingPrice(p, t);
		const afford = selling || ItemController.canAfford(p, price);
		const b = h(`<button class="item${afford ? '' : ' off'}"><span class="t${rarityClass(t)}">${esc(ItemController.describeItemForListView(e, p))}</span><span class="price">${Format.localizeInt(price)} g</span></button>`);
		b.prepend(ui.itemIcon(t));
		b.onclick = () => {
			showItemInfo(ui, t, {
				buttonText: S(selling ? 'shop_sellitem' : 'shop_buyitem', price),
				enabled: selling ? ItemController.maySellItem(p, t) : (price > 0 && afford),
				onAction: () => {
					const max = selling ? p.inventory.getItemQuantity(t.id) : shopInv.getItemQuantity(t.id);
					const doIt = (n) => {
						const ok = selling ? ItemController.sell(p, t, shopInv, n) : ItemController.buy(w.model, p, t, shopInv, n);
						if (ok) ui.toast(S(selling ? 'shop_item_sold' : 'shop_item_bought', t.getName(p)), 1800);
						sheet.rerender(); ui.updateAll();
					};
					if (max > 1) showBulk(ui, t, max, selling ? 'sell' : 'buy', doIt, price);
					else doIt(1);
				},
			});
		};
		list.appendChild(b);
	}
}

// ------------------------------------------------------------------ combat log
export function showCombatLog(ui) {
	const msgs = ui.world.model.combatLog.getAllMessages();
	const body = msgs.length ? '<div class="log">' + msgs.map((m) => (m === '--' ? '<div class="sep"></div>' : `<div>${esc(m)}</div>`)).join('') + '</div>' : `<p class="muted">${esc(S('combat_log_noentries'))}</p>`;
	const s = ui.openSheet({ title: S('combat_log_title'), body, footer: [{ label: S('dialog_close') }] });
	requestAnimationFrame(() => { s.body.scrollTop = s.body.scrollHeight; });
}

// ------------------------------------------------------------------ menu / save / load / settings / new game / about
export function showMenu(ui) {
	const w = ui.world;
	const sheet = ui.openSheet({ title: 'Menu', body: '<div class="list"></div>', footer: [{ label: S('dialog_close') }] });
	const list = sheet.body.querySelector('.list');
	const add = (label, sub, fn) => {
		const b = h(`<button class="item"><span class="t">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></button>`);
		b.onclick = () => { sheet.close(); setTimeout(fn, 0); };
		list.appendChild(b);
	};
	const arrowsOn = ui.prefs.dpadPosition && ui.prefs.dpadPosition !== 'disabled';
	add(arrowsOn ? 'Hide arrow buttons' : 'Show arrow buttons', 'Tapping and holding on the map always works for walking', () => ui.setArrowsVisible(!arrowsOn));
	add(S('menu_save'), w.model.uiSelections.isInCombat ? S('menu_save_saving_not_allowed_in_combat') : 'Save your progress to a slot', () => {
		if (w.model.uiSelections.isInCombat) { ui.toast(S('menu_save_saving_not_allowed_in_combat')); return; }
		showSaveLoad(ui, 'save');
	});
	add(S('combat_log_title'), null, () => showCombatLog(ui));
	add(S('heroinfo_skill'), null, () => showHeroInfo(ui, 'skills'));
	add(S('menu_settings'), null, () => showSettings(ui));
	add(S('exit_to_menu'), 'Your progress is kept in the autosave', () => ui.exitToTitle(true));
}
export function showSaveLoad(ui, mode) {
	const w = ui.world;
	const isSave = mode === 'save';
	let deletedAny = false;
	const sheet = ui.openSheet({ title: S(isSave ? 'loadsave_title_save' : 'loadsave_title_load'), body: '', footer: [{ label: S('dialog_close') }],
		onClose: () => { if (deletedAny && !$('start').hidden) ui.showStart(); } });
	// File downloads don't work inside an embedded frame (such as a claude.ai page), so only offer
	// "Save to file" when the game is the top-level page.
	let canDownload = false;
	try { canDownload = window.top === window.self; } catch (e) { canDownload = false; }
	const render = () => {
		const slots = Savegames.listSlots().filter((s) => s.slot > 0);
		let html = isSave ? `<p class="muted">${esc(S('loadsave_selectslot'))}</p>` : '';
		html += '<div class="list" id="slots"></div>';
		html += `<div class="h3">Backup</div><p class="note">Saves live in this browser on this device. To back one up or move it to another device, ${canDownload ? 'save it to a file or ' : ''}copy it as text, then load the file or paste the text here.</p>
			<div class="row"><button class="btn small" id="impFile">Load save from file</button>${canDownload ? '<button class="btn small" id="expFile">Save autosave to file</button>' : ''}</div>
			<input type="file" id="fileIn" accept=".txt,.json,text/plain,application/json" hidden>
			<div class="row"><button class="btn small" id="exp">Copy autosave as text</button><button class="btn small" id="imp">Paste save into new slot</button></div>
			<textarea id="io" rows="3" style="width:100%;font:12px ui-monospace,monospace;background:var(--panel-2);color:var(--parchment);border:1px solid var(--line);border-radius:8px;padding:8px;-webkit-user-select:text;user-select:text" placeholder="Save text appears here, or paste save text here" aria-label="Save text"></textarea>`;
		sheet.setBody(html);
		const list = sheet.body.querySelector('#slots');
		const fmt = (hd) => `${hd.name} · ${S('savegame_currenthero_displayinfo', hd.level, hd.xp, hd.gold)}`;
		const when = (hd) => (hd.time ? new Date(hd.time).toLocaleString() : '');
		if (isSave) {
			const b = h(`<button class="item"><span class="t">${esc(S('loadsave_save_to_new_slot'))}</span></button>`);
			b.onclick = () => doSave(slots.length ? Math.max(...slots.map((s) => s.slot)) + 1 : 1);
			list.appendChild(b);
		}
		for (const { slot, header } of slots) {
			const b = h(`<button class="item"><span class="t">Slot ${slot}: ${esc(fmt(header))}<small>${esc(when(header))}${header.map ? ' · ' + esc(header.map) : ''}</small></span></button>`);
			b.prepend(ui.icon(header.iconID || 1, 32));
			b.onclick = () => (isSave ? confirmOverwrite(slot, header) : doLoad(slot));
			const del = h(`<button class="slotdel" aria-label="Delete slot ${slot}" title="Delete">✕</button>`);
			del.onclick = () => showConfirm(ui, 'Delete saved game?', `Slot ${slot}: ${fmt(header)}\n\nThis can't be undone.`, 'Delete', () => {
				Savegames.deleteSlot(slot);
				deletedAny = true;
				ui.toast(`Slot ${slot} deleted`);
				render();
			});
			const row = document.createElement('div');
			row.className = 'slotrow';
			row.append(b, del);
			list.appendChild(row);
		}
		if (!isSave && !slots.length) list.innerHTML = '<p class="muted">No saved games yet. You can load a save file below.</p>';
		const io = sheet.body.querySelector('#io');
		sheet.body.querySelector('#exp').onclick = async () => {
			const txt = Savegames.exportSlot(0) || '';
			io.value = txt;
			try { await navigator.clipboard.writeText(txt); ui.toast('Save copied'); } catch (e) { io.select(); ui.toast('Select the text and copy it'); }
		};
		const nextSlot = () => (slots.length ? Math.max(...slots.map((s) => s.slot)) + 1 : 1);
		const fileIn = sheet.body.querySelector('#fileIn');
		sheet.body.querySelector('#impFile').onclick = () => fileIn.click();
		fileIn.onchange = async () => {
			const f = fileIn.files && fileIn.files[0];
			if (!f) return;
			let text = '';
			try { text = await f.text(); } catch (e) { ui.toast('Could not read that file.'); return; }
			const slot = nextSlot();
			try { Savegames.importToSlot(slot, text.trim()); } catch (e) {
				showMessage(ui, 'Not a save file', `"${f.name}" isn't a save from this version of the game. Use a file made with "Save autosave to file", or text copied with "Copy autosave as text". Save files from the Android app can't be loaded.`);
				return;
			}
			const hd = Savegames.getHeader(slot);
			render();
			if (isSave) ui.toast(`Loaded "${f.name}" into slot ${slot}`);
			else showConfirm(ui, 'Save file added', `${hd ? fmt(hd) : f.name} is now in slot ${slot}. Play it now?`, S('startscreen_load'), () => doLoad(slot), 'Not now');
		};
		const expFile = sheet.body.querySelector('#expFile');
		if (expFile) expFile.onclick = () => {
			const txt = Savegames.exportSlot(0);
			if (!txt) { ui.toast('There is no autosave yet.'); return; }
			const hd = Savegames.getHeader(0);
			const name = `andors-trail-${(hd && hd.name ? hd.name : 'save').replace(/[^A-Za-z0-9_-]+/g, '_')}-level${hd ? hd.level : ''}.txt`;
			const url = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
			const a = document.createElement('a');
			a.href = url; a.download = name;
			document.body.appendChild(a); a.click(); a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 5000);
			ui.toast('Save file downloaded');
		};
		sheet.body.querySelector('#imp').onclick = () => {
			try {
				const next = slots.length ? Math.max(...slots.map((s) => s.slot)) + 1 : 1;
				Savegames.importToSlot(next, io.value.trim());
				ui.toast('Imported to slot ' + next);
				render();
			} catch (e) { ui.toast('That text is not a valid save.'); }
		};
	};
	const doSave = (slot) => {
		const ok = Savegames.saveWorld(w, slot);
		ui.toast(ok ? S('menu_save_gamesaved', slot) : 'Saving failed. Your browser storage may be full.');
		sheet.close();
		if (ok && !w.model.statistics.hasUnlimitedSaves()) ui.exitToTitle(false);
	};
	const confirmOverwrite = (slot, header) => {
		if (header.name !== w.model.player.getName()) {
			showConfirm(ui, S('loadsave_save_overwrite_confirmation_title'), S('loadsave_save_overwrite_confirmation', header.name, w.model.player.getName()), 'Overwrite', () => doSave(slot));
		} else doSave(slot);
	};
	const doLoad = (slot) => {
		sheet.close();
		const go = () => ui.loadSlot(slot);
		const hd = Savegames.getHeader(0);
		if (hd && !$('start').hidden) go();
		else if (ui.world.model) showConfirm(ui, S('startscreen_load_game'), S('startscreen_load_game_confirm'), S('startscreen_load'), go);
		else go();
	};
	render();
}
const $ = (id) => document.getElementById(id);

export function showSettings(ui) {
	const p = ui.prefs;
	const sel = (id, label, value, options, help) => `<div class="field"><label for="${id}">${esc(label)}</label><select id="${id}">${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>${help ? `<span class="note">${esc(help)}</span>` : ''}</div>`;
	const chk = (id, label, value, help) => `<label style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" id="${id}" ${value ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--brass);flex:none"><span>${esc(label)}${help ? `<br><span class="note">${esc(help)}</span>` : ''}</span></label>`;
	const body = `
		${sel('pSpeed', S('preferences_combat_speed_title'), p.attackspeed_milliseconds, [[0, S('preferences_attackspeed_instant')], [500, S('preferences_attackspeed_fast')], [1000, S('preferences_attackspeed_normal')], [1500, S('preferences_attackspeed_slow')]], S('preferences_combat_speed'))}
		${sel('pLoot', S('preferences_dialog_monsterloot_title'), p.displayLoot, [['dialog_always', S('preferences_display_loot_dialog')], ['dialog_for_items', S('preferences_display_loot_dialog_on_items')], ['dialog_for_items_else_toast', S('preferences_display_loot_dialog_on_items_or_toast')], ['toast', S('preferences_display_loot_toast')], ['toast_for_items', S('preferences_display_loot_toast_on_items')], ['none', S('preferences_display_loot_never')]])}
		${sel('pMove', S('preferences_movementmethod_title'), p.movementMethod, [['straight', S('preferences_movementmethods_straight')], ['directional', S('preferences_movementmethods_avoid')]], S('preferences_movementmethod'))}
		${sel('pScale', S('preferences_display_scaling_factor_title'), p.scalingFactor, [[0.75, S('preferences_display_scaling_factor_75_percent')], [1, S('preferences_display_scaling_factor_normal')], [1.25, '1.25x size'], [1.5, S('preferences_display_scaling_factor_50_percent_larger')], [2, S('preferences_display_scaling_factor_double')]])}
		${sel('pDpad', S('preferences_movement_dpad_position_title'), p.dpadPosition || 'disabled', [['disabled', S('preferences_movement_dpad_positions_disabled')], ['lower_right', S('preferences_movement_dpad_positions_lower_right')], ['lower_left', S('preferences_movement_dpad_positions_lower_left')]], 'You can always tap a spot on the map to walk there, or press and hold to keep walking.')}
		${chk('pRest', S('preferences_dialog_confirmrest_title'), p.confirmRest, S('preferences_dialog_confirmrest'))}
		${chk('pAttack', S('preferences_dialog_confirmattack_title'), p.confirmAttack, S('preferences_dialog_confirmattack'))}
		${chk('pQuick', 'Show quick slots', p.quickslotsVisible, 'Three buttons above the toolbar for potions and food. Long-press a slot to change it.')}
		${chk('pAnim', 'Animations', p.enableUiAnimations, null)}`;
	const sheet = ui.openSheet({ title: S('menu_settings'), body, footer: [{ label: 'Done', primary: true }],
		onClose: () => { p.write(); if (ui.mapView) { ui.mapView.resize(); } ui.updateAll(); } });
	const b = sheet.body;
	b.querySelector('#pSpeed').onchange = (e) => { p.attackspeed_milliseconds = parseInt(e.target.value, 10); };
	b.querySelector('#pLoot').onchange = (e) => { p.displayLoot = e.target.value; };
	b.querySelector('#pMove').onchange = (e) => { p.movementMethod = e.target.value; };
	b.querySelector('#pScale').onchange = (e) => { p.scalingFactor = parseFloat(e.target.value); };
	b.querySelector('#pDpad').onchange = (e) => { p.dpadPosition = e.target.value; };
	b.querySelector('#pRest').onchange = (e) => { p.confirmRest = e.target.checked; };
	b.querySelector('#pAttack').onchange = (e) => { p.confirmAttack = e.target.checked; };
	b.querySelector('#pQuick').onchange = (e) => { p.quickslotsVisible = e.target.checked; };
	b.querySelector('#pAnim').onchange = (e) => { p.enableUiAnimations = e.target.checked; };
}
export function showNewGame(ui, hasCurrent) {
	let icon = TileManager.CHAR_HERO_0, mode = 0;
	const heroes = [['char_hero_large', TileManager.CHAR_HERO_0], ['char_hero_maksiu_girl_01_large', TileManager.CHAR_HERO_1], ['char_hero_maksiu_boy_01_large', TileManager.CHAR_HERO_2]];
	const modes = getStringArray('startscreen_mode_selector');
	const body = `
		<div class="field"><label>${esc(S('startscreen_selectherosprite'))}</label><div class="heroes">${heroes.map(([img, id], i) => `<button data-icon="${id}" aria-pressed="${i === 0}" aria-label="Hero ${i + 1}"><img src="data/img/${img}.png" alt=""></button>`).join('')}</div></div>
		<div class="field"><label for="heroName">${esc(S('startscreen_enterheroname'))}</label><input id="heroName" maxlength="24" autocomplete="off" autocapitalize="words" value="" placeholder="Name"></div>
		<div class="field"><label for="heroMode">${esc(S('startscreen_game_mode'))}</label><select id="heroMode">${modes.map((m, i) => `<option value="${i}">${esc(m)}</option>`).join('')}</select></div>
		${hasCurrent ? `<p class="note">${esc(S('startscreen_newgame_confirm'))}</p>` : ''}`;
	const sheet = ui.openSheet({ title: S('startscreen_newgame'), body });
	sheet.body.querySelectorAll('[data-icon]').forEach((b) => { b.onclick = () => { sheet.body.querySelectorAll('[data-icon]').forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); icon = parseInt(b.dataset.icon, 10); }; });
	sheet.body.querySelector('#heroMode').onchange = (e) => { mode = parseInt(e.target.value, 10); };
	sheet.setFooter([{ label: 'Cancel' }, { label: S('startscreen_newgame_start'), primary: true, onClick: () => {
		const name = sheet.body.querySelector('#heroName').value.trim();
		if (!name) { ui.toast(S('startscreen_enterheroname')); sheet.body.querySelector('#heroName').focus(); return true; }
		const lives = [-1, -1, 50, 10, 3, 1][mode];
		const unlimitedSaves = mode === 0;
		setTimeout(() => ui.startNewGame(name, icon, lives, unlimitedSaves), 0);
	} }]);
}
export function showAbout(ui) {
	ui.openSheet({
		title: "About Andor's Trail",
		body: `<p>Andor's Trail is a free, open-source fantasy RPG created by Oskar Wiksten, the Andor's Trail team and contributors. This is the browser version of 0.8.18: the same maps, quests and items as the Android release, with touch controls for phones.</p>
		<p class="h3">How to play</p>
		<p>Tap a spot on the map to walk there, or press and hold to keep walking toward your finger. Walk into people to talk and into monsters to fight.</p>
		<p>In combat, tap an adjacent enemy to select it, then tap it again or press Attack. Each action costs action points (AP); press End turn when you are done. To flee, press Flee and tap the direction to run.</p>
		<p>The game saves automatically when you leave the page or change area. Use Menu → Save for extra save slots.</p>
		<p class="h3">Play it like an app</p>
		<p>On iPhone, tap the Share button in Safari and choose “Add to Home Screen” to launch it full screen.</p>
		<p class="h3">Credits and licences</p>
		<p class="note">Game code is released under the GNU GPL v2. Game content (story, maps, quests, dialogue) is copyright its authors and licensed for use in Andor's Trail. Graphics are by the artists listed in the game's credits, under their own licences. Interface fonts: Alegreya SC and Alegreya Sans by Huerta Tipográfica (SIL Open Font License).</p>
		<p class="note">Original game and full credits: github.com/AndorsTrailRelease/andors-trail</p>`,
		footer: [{ label: S('dialog_close') }],
	});
}

// ------------------------------------------------------------------ world map (simplified WorldMapController)
export async function showWorldMap(ui) {
	const w = ui.world;
	const cur = w.model.currentMaps.map;
	const segName = w.maps.getWorldMapSegmentNameForMap(cur.name);
	if (!segName) { ui.toast('There is no world map for this place.'); return; }
	const seg = w.maps.worldMapSegments.get(segName);
	const sheet = ui.openSheet({ title: 'World map', sub: 'Places you have visited', full: true, body: '<p class="muted">Drawing map…</p>', footer: [{ label: S('dialog_close') }] });
	// bounds of visited maps
	const entries = [...seg.maps.values()].map((m) => ({ m, pm: w.maps.findPredefinedMap(m.mapName) })).filter((e) => e.pm && (e.pm.visited || e.pm === cur));
	if (!entries.length) { sheet.setBody('<p class="muted">Nothing explored yet.</p>'); return; }
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const { m, pm } of entries) {
		minX = Math.min(minX, m.worldPosition.x); minY = Math.min(minY, m.worldPosition.y);
		maxX = Math.max(maxX, m.worldPosition.x + pm.size.width); maxY = Math.max(maxY, m.worldPosition.y + pm.size.height);
	}
	const TS = 8; // world-map tile size (WORLDMAP_SCREENSHOT_TILESIZE)
	const cv = document.createElement('canvas');
	cv.width = (maxX - minX) * TS; cv.height = (maxY - minY) * TS;
	const ctx = cv.getContext('2d');
	ctx.imageSmoothingEnabled = false;
	ctx.fillStyle = '#0c0e10'; ctx.fillRect(0, 0, cv.width, cv.height);
	const wrap = document.createElement('div');
	wrap.className = 'wm';
	wrap.appendChild(cv);
	const legend = document.createElement('p');
	legend.className = 'note';
	legend.textContent = 'You are at the blinking marker. Named places are labelled.';
	sheet.setBody('');
	sheet.body.appendChild(wrap);
	sheet.body.appendChild(legend);
	cv.style.width = (cv.width * 1.5) + 'px';
	for (const { m, pm } of entries) {
		if (sheet.closed) return;
		try {
			const tm = pm === cur ? w.model.currentMaps.tileMap : await w.mapLoader.loadLayeredTileMap(pm);
			await ui.renderer.ensureTilesFor(tm.usedTileIDs);
			const L = tm.currentLayout;
			const ox = (m.worldPosition.x - minX) * TS, oy = (m.worldPosition.y - minY) * TS;
			for (const layer of [L.layerBase, L.layerGround, L.layerObjects, L.layerAbove, L.layerTop]) {
				if (!layer) continue;
				for (let x = 0; x < pm.size.width; x++) for (let y = 0; y < pm.size.height; y++) {
					const id = layer.get(x, y);
					if (id) ui.renderer.drawTile(ctx, id, ox + x * TS, oy + y * TS, TS);
				}
			}
		} catch (e) { console.warn('worldmap', pm.name, e); }
	}
	// labels
	ctx.font = 'bold 22px "Alegreya SC", serif';
	ctx.textAlign = 'center';
	for (const a of seg.namedAreas.values()) {
		const ms = [...a.mapNames].map((n) => seg.maps.get(n)).filter(Boolean).filter((mm) => entries.some((e) => e.m === mm));
		if (!ms.length) continue;
		let x = 0, y = 0;
		for (const mm of ms) { const pm = w.maps.findPredefinedMap(mm.mapName); x += (mm.worldPosition.x - minX + pm.size.width / 2) * TS; y += (mm.worldPosition.y - minY + pm.size.height / 2) * TS; }
		x /= ms.length; y /= ms.length;
		ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(a.name, x, y);
		ctx.fillStyle = a.type === 'settlement' ? '#f0d78a' : '#e8e2d0'; ctx.fillText(a.name, x, y);
	}
	// player marker
	const me = seg.maps.get(cur.name);
	if (me) {
		const px = (me.worldPosition.x - minX + w.model.player.position.x) * TS, py = (me.worldPosition.y - minY + w.model.player.position.y) * TS;
		ctx.strokeStyle = '#ff4a3a'; ctx.lineWidth = 3;
		ctx.strokeRect(px - 6, py - 6, TS + 12, TS + 12);
		requestAnimationFrame(() => { wrap.scrollLeft = px * 1.5 - wrap.clientWidth / 2; wrap.scrollTop = py * 1.5 - wrap.clientHeight / 2; });
	}
}
