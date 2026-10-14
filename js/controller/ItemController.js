// Port of controller/ItemController.java
import { Constants, Format, ListOfListeners, idiv } from '../util.js';
import { WearSlot, SC } from '../model.js';
import { SkillController } from './SkillController.js';
import { getString } from '../strings.js';

export class ItemController {
	constructor(controllers, world) {
		this.controllers = controllers;
		this.world = world;
		this.quickSlotListeners = new ListOfListeners();
	}
	dropItem(type, quantity) {
		const p = this.world.model.player;
		if (p.inventory.getItemQuantity(type.id) < quantity) return;
		p.inventory.removeItem(type.id, quantity);
		this.world.model.currentMaps.map.itemDropped(type, quantity, p.position);
	}
	equipItem(type, slot) {
		if (!type.isEquippable()) return;
		const player = this.world.model.player;
		const inCombat = this.world.model.uiSelections.isInCombat;
		if (inCombat && !this.controllers.actorStatsController.useAPs(player, player.getReequipCost())) return;
		if (!player.inventory.removeItem(type.id, 1)) return;
		this._unequipSlot(player, slot);
		if (type.isTwohandWeapon()) this._unequipSlot(player, 'shield');
		else if (slot === 'shield') {
			const w = player.inventory.getItemTypeInWearSlot('weapon');
			if (w != null && w.isTwohandWeapon()) this._unequipSlot(player, 'weapon');
		}
		player.inventory.setItemTypeInWearSlot(slot, type);
		this.controllers.actorStatsController.addConditionsFromEquippedItem(player, type);
		this.controllers.actorStatsController.recalculatePlayerStats(player);
		if (inCombat && !this.controllers.combatController.playerHasApLeft()) this.controllers.combatController.endPlayerTurn();
	}
	unequipSlot(type, slot) {
		if (!type.isEquippable()) return;
		const player = this.world.model.player;
		if (player.inventory.isEmptySlot(slot)) return;
		const inCombat = this.world.model.uiSelections.isInCombat;
		if (inCombat && !this.controllers.actorStatsController.useAPs(player, player.getReequipCost())) return;
		this._unequipSlot(player, slot);
		this.controllers.actorStatsController.recalculatePlayerStats(player);
		if (inCombat && !this.controllers.combatController.playerHasApLeft()) this.controllers.combatController.endPlayerTurn();
	}
	_unequipSlot(player, slot) {
		const removed = player.inventory.getItemTypeInWearSlot(slot);
		if (removed == null) return;
		player.inventory.addItem(removed);
		player.inventory.setItemTypeInWearSlot(slot, null);
		this.controllers.actorStatsController.removeConditionsFromUnequippedItem(player, removed);
	}
	useItem(type) {
		if (!type || !type.isUsable()) return;
		const player = this.world.model.player;
		const inCombat = this.world.model.uiSelections.isInCombat;
		if (inCombat && !this.controllers.actorStatsController.useAPs(player, player.getUseItemCost())) return;
		if (!player.inventory.removeItem(type.id, 1)) return;
		this.world.model.combatLog.append(getString('inventory_item_used', type.getName(player)));
		this.controllers.actorStatsController.applyUseEffect(player, null, type.effects_use);
		this.world.model.statistics.addItemUsage(type);
		if (inCombat && !this.controllers.combatController.playerHasApLeft()) this.controllers.combatController.endPlayerTurn();
	}
	playerSteppedOnLootBag(loot) {
		const wel = this.controllers.mapController.worldEventListeners;
		if (this.pickupLootBagWithoutConfirmation(loot)) {
			wel.emit('onPlayerPickedUpGroundLoot', loot);
			this.pickupAll(loot);
			this.removeLootBagIfEmpty(loot);
		} else {
			wel.emit('onPlayerSteppedOnGroundLoot', loot);
			this.consumeNonItemLoot(loot);
		}
	}
	lootMonsterBags(bags, totalExp) {
		const wel = this.controllers.mapController.worldEventListeners;
		if (this.pickupLootBagsWithoutConfirmation(bags)) {
			wel.emit('onPlayerPickedUpMonsterLoot', bags, totalExp);
			this.pickupAll(bags);
			this.removeLootBagIfEmpty(bags);
		} else {
			wel.emit('onPlayerFoundMonsterLoot', bags, totalExp);
			this.consumeNonItemLoot(bags);
		}
	}
	pickupLootBagWithoutConfirmation(bag) {
		if (bag.isContainer()) return false;
		switch (this.controllers.preferences.displayLoot) {
			case 'dialog_always': return false;
			case 'dialog_for_items': case 'dialog_for_items_else_toast':
				if (bag.hasItems()) return false;
		}
		return true;
	}
	pickupLootBagsWithoutConfirmation(bags) {
		if (this.controllers.preferences.displayLoot === 'dialog_always') return false;
		for (const b of bags) if (!this.pickupLootBagWithoutConfirmation(b)) return false;
		return true;
	}
	applyInventoryEffects(player) {
		const weapon = ItemController.getMainWeapon(player);
		if (weapon != null) {
			player.attackCost = 0;
			player.criticalMultiplier = weapon.effects_equip.stats.setCriticalMultiplier;
		}
		this._applyInventoryEffectsSlot(player, 'weapon');
		this._applyInventoryEffectsSlot(player, 'shield');
		SkillController.applySkillEffectsFromFightingStyles(player, this.controllers);
		for (const s of ['head', 'body', 'hand', 'feet', 'neck', 'leftring', 'rightring']) this._applyInventoryEffectsSlot(player, s);
		SkillController.applySkillEffectsFromItemProficiencies(player, this.controllers);
	}
	static getMainWeapon(player) {
		let t = player.inventory.getItemTypeInWearSlot('weapon');
		if (t != null) return t;
		t = player.inventory.getItemTypeInWearSlot('shield');
		if (t != null && t.isWeapon()) return t;
		return null;
	}
	_applyInventoryEffectsSlot(player, slot) {
		const type = player.inventory.getItemTypeInWearSlot(slot);
		if (type == null) return;
		if (slot === 'shield') {
			const main = player.inventory.getItemTypeInWearSlot('weapon');
			if (SkillController.isDualWielding(main, type)) return;
		}
		if (type.effects_equip != null && type.effects_equip.stats != null) {
			this.controllers.actorStatsController.applyAbilityEffects(player, type.effects_equip.stats, 1);
			if (type.isWeapon()) this.controllers.actorStatsController.addPlayerWeaponDamage(player, type.effects_equip.stats.increaseMinDamage, type.effects_equip.stats.increaseMaxDamage);
		}
	}
	static recalculateHitEffectsFromWornItems(player) {
		let onHit = null, onMiss = null, onHitRecv = null, onMissRecv = null;
		for (const slot of WearSlot.values) {
			const t = player.inventory.getItemTypeInWearSlot(slot);
			if (t == null) continue;
			const eh = t.effects_hit, ehr = t.effects_hitReceived, em = t.effects_miss, emr = t.effects_missReceived;
			if (eh == null && ehr == null && em == null && emr == null) continue;
			(onHit || (onHit = [])); if (eh) onHit.push(eh);
			(onMiss || (onMiss = [])); if (em) onMiss.push(em);
			(onHitRecv || (onHitRecv = [])); if (ehr) onHitRecv.push(ehr);
			(onMissRecv || (onMissRecv = [])); if (emr) onMissRecv.push(emr);
		}
		player.onHitEffects = onHit;
		player.onMissEffects = onMiss;
		player.onHitReceivedEffects = onHitRecv;
		player.onMissReceivedEffects = onMissRecv;
	}
	consumeNonItemLoot(loot) {
		if (Array.isArray(loot)) { for (const l of loot) this.consumeNonItemLoot(l); return; }
		this.world.model.player.inventory.gold += loot.gold;
		loot.gold = 0;
		this.removeLootBagIfEmpty(loot);
	}
	pickupAll(loot) {
		if (Array.isArray(loot)) { for (const l of loot) this.pickupAll(l); return; }
		this.world.model.player.inventory.add(loot.items);
		this.consumeNonItemLoot(loot);
		this.checkQuickslotItemLooted(loot.items);
		loot.clear();
	}
	removeLootBagIfEmpty(loot) {
		if (Array.isArray(loot)) { let empty = true; for (const l of loot) if (!this.removeLootBagIfEmpty(l)) empty = false; return empty; }
		if (loot.hasItemsOrGold()) return false;
		this.world.model.currentMaps.map.removeGroundLoot(loot);
		this.controllers.mapController.mapLayoutListeners.emit('onLootBagRemoved', this.world.model.currentMaps.map, loot.position);
		return true;
	}
	static getMarketPriceFactor(player) {
		return Constants.MARKET_PRICEFACTOR_PERCENT - player.getSkillLevel('barter') * SC.PER_SKILLPOINT_INCREASE_BARTER_PRICEFACTOR_PERCENTAGE;
	}
	static getBuyingPrice(player, t) { return t.baseMarketCost + idiv(t.baseMarketCost * ItemController.getMarketPriceFactor(player), 100); }
	static getSellingPrice(player, t) { return t.baseMarketCost - idiv(t.baseMarketCost * ItemController.getMarketPriceFactor(player), 100); }
	static canAfford(player, x) {
		const price = typeof x === 'number' ? x : ItemController.getBuyingPrice(player, x);
		return player.inventory.gold >= price;
	}
	static maySellItem(player, t) { return t.isSellable(); }
	static sell(player, t, merchant, quantity) {
		const price = ItemController.getSellingPrice(player, t) * quantity;
		if (!ItemController.maySellItem(player, t)) return false;
		if (!player.inventory.removeItem(t.id, quantity)) return false;
		player.inventory.gold += price;
		merchant.addItem(t, quantity);
		return true;
	}
	static buy(model, player, t, merchant, quantity) {
		const price = ItemController.getBuyingPrice(player, t) * quantity;
		if (!ItemController.canAfford(player, price)) return false;
		if (!merchant.removeItem(t.id, quantity)) return false;
		player.inventory.gold -= price;
		player.inventory.addItem(t, quantity);
		model.statistics.addGoldSpent(price);
		return true;
	}
	static describeItemForListView(item, player) {
		let sb = item.itemType.getName(player);
		if (item.quantity > 1) sb += ' (' + Format.localizeInt(item.quantity) + ')';
		const eq = item.itemType.effects_equip;
		if (eq != null && eq.stats != null) {
			const t = eq.stats;
			if (t.increaseAttackChance !== 0 || t.increaseMinDamage !== 0 || t.increaseMaxDamage !== 0 || t.increaseCriticalSkill !== 0 || t.setCriticalMultiplier !== 0) {
				sb += ' [' + ItemController.describeAttackEffect(t.increaseAttackChance, t.increaseMinDamage, t.increaseMaxDamage, t.increaseCriticalSkill, t.setCriticalMultiplier) + ']';
			}
			if (t.increaseBlockChance !== 0 || t.increaseDamageResistance !== 0) {
				sb += ' [' + ItemController.describeBlockEffect(t.increaseBlockChance, t.increaseDamageResistance) + ']';
			}
		}
		return sb;
	}
	static describeAttackEffect(ac, minD, maxD, cs, cm) {
		let sb = '', sp = false;
		if (ac !== 0) { sb += ac; sp = true; }
		if (minD !== 0 || maxD !== 0) { if (sp) sb += ' '; sb += minD; if (minD !== maxD) sb += '-' + maxD; sp = true; }
		if (cs !== 0) { if (sp) sb += ' '; if (cs >= 0) sb += '+'; sb += cs; }
		if (cm !== 0 && cm !== 1) sb += '×' + Format.localizeFloat(cm, 1);
		return sb;
	}
	static describeBlockEffect(bc, dr) {
		let sb = '';
		if (bc !== 0) sb += bc;
		if (dr !== 0) sb += '/' + dr;
		return sb;
	}
	quickitemUse(i) {
		this.useItem(this.world.model.player.inventory.quickitem[i]);
		this.quickSlotListeners.emit('onQuickSlotUsed', i);
	}
	setQuickItem(itemType, i) {
		this.world.model.player.inventory.quickitem[i] = itemType;
		this.quickSlotListeners.emit('onQuickSlotChanged', i);
	}
	checkQuickslotItemLooted(items) {
		const q = this.world.model.player.inventory.quickitem;
		for (const it of items.items) {
			if (!it.itemType.isUsable()) continue;
			for (let i = 0; i < q.length; i++) if (it.itemType === q[i]) this.quickSlotListeners.emit('onQuickSlotChanged', i);
		}
	}
	removeEquippedItem(itemTypeID, count) {
		let removed = 0;
		const player = this.world.model.player;
		for (const slot of WearSlot.values) {
			const t = player.inventory.getItemTypeInWearSlot(slot);
			if (t != null && t.id === itemTypeID) {
				player.inventory.setItemTypeInWearSlot(slot, null);
				this.controllers.actorStatsController.removeConditionsFromUnequippedItem(player, t);
				this.controllers.actorStatsController.recalculatePlayerStats(player);
				if (++removed >= count) break;
			}
		}
		return removed;
	}
	static applyDamageModifier(player) {
		let t = player.inventory.getItemTypeInWearSlot('weapon');
		let m1 = -1, m2 = -1;
		if (t != null && t.effects_equip && t.effects_equip.stats) m1 = t.effects_equip.stats.setNonWeaponDamageModifier;
		t = player.inventory.getItemTypeInWearSlot('shield');
		if (t != null && t.isWeapon() && t.effects_equip && t.effects_equip.stats) m2 = t.effects_equip.stats.setNonWeaponDamageModifier;
		let modifier = 100;
		if (m1 >= 0 && m2 >= 0) {
			const lvl = player.getSkillLevel('fightstyleDualWield');
			if (lvl === 2) modifier = Math.max(m1, m2);
			else if (lvl === 1) modifier = idiv(m1 + m2, 2);
			else modifier = Math.min(m1, m2);
		} else if (m1 <= 0 && m2 >= 0) modifier = m2;
		else if (m2 <= 0 && m1 >= 0) modifier = m1;
		if (modifier !== 100) {
			const minBase = player.damagePotential.current - player.weaponDamage.current;
			const maxBase = player.damagePotential.max - player.weaponDamage.max;
			player.damagePotential.add(Math.round(minBase * ((modifier - 100) / 100)), true);
			player.damagePotential.addToMax(Math.round(maxBase * ((modifier - 100) / 100)));
		}
	}
}
