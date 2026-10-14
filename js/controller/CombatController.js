// Port of controller/CombatController.java
import { Coord, Constants, Format, ListOfListeners, toInt } from '../util.js';
import { Loot, SC } from '../model.js';
import { MovementController } from './MovementController.js';
import { getString } from '../strings.js';

export class AttackResult {
	constructor(isHit, isCriticalHit, damage, targetDied) {
		this.isHit = isHit; this.isCriticalHit = isCriticalHit; this.damage = damage; this.targetDied = targetDied;
	}
}
AttackResult.MISS = new AttackResult(false, false, 0, false);

export const BeginTurnAs = { player: 'player', monsters: 'monsters', continueLastTurn: 'continueLastTurn' };

const CALLBACK_MONSTERATTACK = 0;
const CALLBACK_PLAYERATTACK = 1;
const n_ = 50, F_ = 40, two_divided_by_PI = 2 / Math.PI;

export class CombatController {
	constructor(controllers, world) {
		this.controllers = controllers;
		this.world = world;
		this.combatSelectionListeners = new ListOfListeners();
		this.combatActionListeners = new ListOfListeners();
		this.combatTurnListeners = new ListOfListeners();
		this.currentActiveMonster = null;
		this.killedMonsterBags = [];
		this.totalExpThisFight = 0;
		this.lastAttackResult = null;
		this.monsterTurnTimer = null;
	}
	get ui() { return this.world.model.uiSelections; }

	resumeCombatIfNeeded() {
		if (!this.ui.isMainActivityVisible) return;
		if (!this.ui.isInCombat) return;
		this.setCombatSelection(this.ui.selectedMonster, this.ui.selectedPosition);
		this.enterCombat(BeginTurnAs.continueLastTurn);
	}
	enterCombat(whoseTurn) {
		this.ui.isInCombat = true;
		this.resetCombatState();
		this.combatTurnListeners.emit('onCombatStarted');
		if (whoseTurn === BeginTurnAs.player) this.newPlayerTurn(true);
		else if (whoseTurn === BeginTurnAs.monsters) this.beginMonsterTurn(true);
		else this.continueTurn();
	}
	exitCombat(pickupLootBags, canceledCombat = false) {
		this.setCombatSelection(null, null);
		this.ui.isInCombat = false;
		if (pickupLootBags) this.recordLootInCombatLog();
		this.combatTurnListeners.emit('onCombatEnded');
		this.controllers.actorStatsController.setActorMaxAP(this.world.model.player);
		this.ui.selectedPosition = null;
		this.ui.selectedMonster = null;
		if (this.world.model.player.isDead() || canceledCombat) this.controllers.gameRoundController.resetRoundTimers();
		else this.endOfCombatRound();
		if (pickupLootBags && this.totalExpThisFight > 0) {
			this.controllers.itemController.lootMonsterBags(this.killedMonsterBags, this.totalExpThisFight);
		}
		this.controllers.gameRoundController.onCombatStateChanged();
		this.resetCombatState();
	}
	recordLootInCombatLog() {
		const combined = Loot.combine(this.killedMonsterBags);
		if (combined.gold > 0) this.world.model.combatLog.append(getString('dialog_loot_foundgold', combined.gold));
		const itemCount = combined.items.countItems();
		if (itemCount > 0) {
			let msg = itemCount === 1 ? getString('combat_log_item_single') : getString('combat_log_item_plural', itemCount);
			let first = true;
			for (const e of combined.items.items) {
				if (!first) msg += getString('combat_log_item_list_separator');
				msg += getString('combat_log_item_name_qty', e.itemType.getName(this.world.model.player), e.quantity);
				first = false;
			}
			this.world.model.combatLog.append(msg);
		}
	}
	resetCombatState() {
		this.killedMonsterBags.length = 0;
		this.totalExpThisFight = 0;
		this.currentActiveMonster = null;
	}
	// setCombatSelection(monster) | (monster, coord) | (coord)
	setCombatSelection(a, b) {
		if (a instanceof Coord && b === undefined) return this._setCombatSelectionCoord(a);
		if (a != null && b === undefined) {
			const p = a.rectPosition.findPositionAdjacentTo(this.world.model.player.position);
			return this._setCombatSelection(a, p);
		}
		return this._setCombatSelection(a, b);
	}
	_setCombatSelection(selectedMonster, selectedPosition) {
		if (selectedMonster != null && !selectedMonster.isAgressive(this.world.model.player)) return;
		let previousSelection = this.ui.selectedPosition;
		if (previousSelection != null) {
			this.ui.selectedPosition = null;
			if (!(selectedPosition == null || !selectedPosition.equals(previousSelection))) previousSelection = null;
		}
		this.ui.selectedMonster = selectedMonster;
		if (selectedPosition != null) {
			this.ui.selectedPosition = new Coord(selectedPosition);
			this.ui.isInCombat = true;
		} else {
			this.ui.selectedPosition = null;
		}
		if (selectedMonster != null) this.combatSelectionListeners.emit('onMonsterSelected', selectedMonster, selectedPosition, previousSelection);
		else if (selectedPosition != null) this.combatSelectionListeners.emit('onMovementDestinationSelected', selectedPosition, previousSelection);
		else if (previousSelection != null) this.combatSelectionListeners.emit('onCombatSelectionCleared', previousSelection);
	}
	_setCombatSelectionCoord(p) {
		const m = this.world.model.currentMaps.map.getMonsterAt(p);
		if (m != null) this._setCombatSelection(m, p);
		else if (this.world.model.currentMaps.tileMap.isWalkable(p)) this._setCombatSelection(null, p);
	}
	useAPs(cost) {
		if (this.controllers.actorStatsController.useAPs(this.world.model.player, cost)) return true;
		this.combatActionListeners.emit('onPlayerDoesNotHaveEnoughAP');
		return false;
	}
	canExitCombat() { return this.getAdjacentAggressiveMonster() == null; }
	getAdjacentAggressiveMonster() {
		return MovementController.getAdjacentAggressiveMonster(this.world.model.currentMaps.map, this.world.model.player);
	}
	executeMoveAttack(dx, dy) {
		if (!this.ui.isPlayersCombatTurn) return;
		if (this.ui.selectedMonster != null) this.executePlayerAttack();
		else if (this.ui.selectedPosition != null) this.executeCombatMove(this.ui.selectedPosition);
		else if (this.controllers.effectController.isRunningVisualEffect()) return;
		else if (this.canExitCombat()) this.exitCombat(true);
		else if (dx !== 0 || dy !== 0) this.executeFlee(dx, dy);
		else {
			const m = this.getAdjacentAggressiveMonster();
			if (m == null) return;
			this.setCombatSelection(m);
			this.executePlayerAttack();
		}
	}
	executeFlee(dx, dy) {
		if (!this.controllers.movementController.findWalkablePosition(dx, dy, 'defensive')) return;
		const m = this.world.model.currentMaps.map.getMonsterAt(this.world.model.player.nextPosition);
		if (m != null) return;
		this.executeCombatMove(this.world.model.player.nextPosition);
	}
	executePlayerAttack() {
		if (this.controllers.effectController.isRunningVisualEffect()) return;
		if (!this.useAPs(this.world.model.player.getAttackCost())) return;
		const target = this.ui.selectedMonster;
		const attackPosition = this.ui.selectedPosition;
		const attack = this.attack(this.world.model.player, target);
		this.lastAttackResult = attack;
		if (attack.isHit) {
			this.combatActionListeners.emit('onPlayerAttackSuccess', target, attack);
			if (attack.targetDied) this.playerKilledMonster(target);
			this.controllers.skillController.applySkillEffectsFromPlayerAttack(attack, target);
			this.startAttackEffect(attack, attackPosition, CALLBACK_PLAYERATTACK);
		} else {
			this.combatActionListeners.emit('onPlayerAttackMissed', target, attack);
			this.controllers.skillController.applySkillEffectsFromPlayerAttack(attack, target);
			this.startMissedEffect(attack, attackPosition, CALLBACK_PLAYERATTACK);
		}
	}
	playerAttackCompleted() {
		if (this.ui.selectedMonster == null) this.selectNextAggressiveMonster();
		this.playerActionCompleted();
	}
	playerKilledMonster(killedMonster) {
		const player = this.world.model.player;
		const map = this.world.model.currentMaps.map;
		const loot = map.getBagOrCreateAt(killedMonster.position);
		killedMonster.createLoot(loot, player);
		this.controllers.monsterSpawnController.remove(map, killedMonster);
		this.controllers.effectController.addSplatter(map, killedMonster);
		this.controllers.actorStatsController.addActorAP(player, player.getSkillLevel('cleave') * SC.PER_SKILLPOINT_INCREASE_CLEAVE_AP);
		this.controllers.actorStatsController.addActorHealth(player, player.getSkillLevel('eater') * SC.PER_SKILLPOINT_INCREASE_EATER_HEALTH);
		this.world.model.statistics.addMonsterKill(killedMonster.monsterType);
		this.controllers.actorStatsController.addExperience(loot.exp);
		this.world.model.combatLog.append(getString('dialog_monsterloot_gainedexp', loot.exp));
		this.totalExpThisFight += loot.exp;
		loot.exp = 0;
		this.controllers.actorStatsController.applyKillEffectsToPlayer(player);
		this.controllers.actorStatsController.applyOnDeathEffectsToPlayer(player, killedMonster);
		if (!loot.hasItemsOrGold()) map.removeGroundLoot(loot);
		else if (this.ui.isInCombat && !this.killedMonsterBags.includes(loot)) this.killedMonsterBags.push(loot);
		this.combatActionListeners.emit('onPlayerKilledMonster', killedMonster);
		if (this.ui.selectedMonster === killedMonster) this.selectNextAggressiveMonster();
	}
	selectNextAggressiveMonster() {
		const next = this.getAdjacentAggressiveMonster();
		if (next == null) { this.setCombatSelection(null, null); return false; }
		this.setCombatSelection(next);
		return true;
	}
	playerHasApLeft() {
		const p = this.world.model.player;
		return p.hasAPs(p.getUseItemCost()) || p.hasAPs(p.getAttackCost()) || p.hasAPs(p.getMoveCost());
	}
	playerActionCompleted() {
		if (!this.ui.isInCombat) return;
		if (this.canExitCombat()) { this.exitCombat(true); return; }
		if (!this.playerHasApLeft()) this.endPlayerTurn();
	}
	continueTurn() {
		if (this.ui.isPlayersCombatTurn) return;
		if (this.playerHasApLeft()) { this.ui.isPlayersCombatTurn = true; return; }
		this.handleNextMonsterAction();
	}
	executeCombatMove(dest) {
		if (this.ui.selectedMonster != null) return;
		if (dest == null) return;
		if (!this.useAPs(this.world.model.player.getMoveCost())) return;
		const bias = this.world.model.player.getSkillLevel('evasion') * SC.PER_SKILLPOINT_INCREASE_EVASION_FLEE_CHANCE_PERCENTAGE;
		if (Constants.roll100(Constants.FLEE_FAIL_CHANCE_PERCENT - bias)) { this.fleeingFailed(); return; }
		this.world.model.player.nextPosition.set(dest);
		this.controllers.movementController.moveToNextIfPossible();
		this.playerActionCompleted();
	}
	fleeingFailed() {
		this.combatActionListeners.emit('onPlayerFailedFleeing');
		this.endPlayerTurn();
	}
	waitForNextMonsterAction() {
		const ms = this.controllers.preferences.attackspeed_milliseconds;
		if (ms <= 0) this.handleNextMonsterAction();
		else { clearTimeout(this.monsterTurnTimer); this.monsterTurnTimer = setTimeout(() => this.handleNextMonsterAction(), ms); }
	}
	endPlayerTurn() { this.beginMonsterTurn(false); }
	beginMonsterTurn(isFirstRound) {
		this.controllers.actorStatsController.setActorMinAP(this.world.model.player);
		this.ui.isPlayersCombatTurn = false;
		for (const a of this.world.model.currentMaps.map.spawnAreas) for (const m of a.monsters) this.controllers.actorStatsController.setActorMaxAP(m);
		this.currentActiveMonster = null;
		if (!isFirstRound) this.controllers.gameRoundController.onNewMonsterRound();
		this.handleNextMonsterAction();
	}
	determineNextMonsterAction(playerPosition) {
		if (this.currentActiveMonster != null && CombatController.shouldAttackWithMonsterInCombat(this.currentActiveMonster, playerPosition)) return 'attack';
		for (const a of this.world.model.currentMaps.map.spawnAreas) {
			for (const m of a.monsters) {
				if (!m.isAgressive(this.world.model.player)) continue;
				if (CombatController.shouldAttackWithMonsterInCombat(m, playerPosition)) { this.currentActiveMonster = m; return 'attack'; }
				if (CombatController.shouldMoveMonsterInCombat(m, a, this.world.model.player, playerPosition)) { this.currentActiveMonster = m; return 'move'; }
			}
		}
		return 'none';
	}
	static shouldAttackWithMonsterInCombat(m, playerPosition) {
		if (!m.hasAPs(m.getAttackCost())) return false;
		return m.rectPosition.isAdjacentTo(playerPosition);
	}
	static shouldMoveMonsterInCombat(m, a, p, playerPosition) {
		const t = m.getMovementAggressionType();
		if (t === 'none') return false;
		if (!m.hasAPs(m.getMoveCost())) return false;
		if (m.position.isAdjacentTo(playerPosition)) return false;
		if (!m.isAgressive(p)) return false;
		if (t === 'protectSpawn') { if (a.area.contains(playerPosition)) return true; }
		else if (t === 'helpOthers') { for (const o of a.monsters) { if (o !== m && o.rectPosition.isAdjacentTo(playerPosition)) return true; } }
		else if (t === 'wholeMap') return true;
		return false;
	}
	handleNextMonsterAction() {
		if (!this.ui.isMainActivityVisible) return;
		const next = this.determineNextMonsterAction(this.world.model.player.position);
		if (next === 'none') this.endMonsterTurn();
		else if (next === 'attack') this.attackWithCurrentMonster();
		else if (next === 'move') this.moveCurrentMonster();
	}
	moveCurrentMonster() {
		this.controllers.actorStatsController.useAPs(this.currentActiveMonster, this.currentActiveMonster.getMoveCost());
		if (!this.controllers.monsterMovementController.findPathFor(this.currentActiveMonster, this.world.model.player.position)) {
			this.handleNextMonsterAction();
			return;
		}
		const moving = this.currentActiveMonster;
		this.controllers.monsterMovementController.moveMonsterToNextPositionDuringCombat(moving, this.world.model.currentMaps.map, {
			onVisualEffectCompleted: () => {
				this.combatActionListeners.emit('onMonsterMovedDuringCombat', moving);
				this.handleNextMonsterAction();
			},
		});
	}
	attackWithCurrentMonster() {
		const m = this.currentActiveMonster;
		this.controllers.actorStatsController.useAPs(m, m.getAttackCost());
		this.combatTurnListeners.emit('onMonsterIsAttacking', m);
		const attack = this.attack(m, this.world.model.player);
		this.lastAttackResult = attack;
		if (attack.isHit) {
			this.combatActionListeners.emit('onMonsterAttackSuccess', m, attack);
			this.controllers.skillController.applySkillEffectsFromMonsterAttack(attack, m);
			this.startAttackEffect(attack, this.world.model.player.position, CALLBACK_MONSTERATTACK);
		} else {
			this.combatActionListeners.emit('onMonsterAttackMissed', m, attack);
			this.controllers.skillController.applySkillEffectsFromMonsterAttack(attack, m);
			this.startMissedEffect(attack, this.world.model.player.position, CALLBACK_MONSTERATTACK);
		}
	}
	onVisualEffectCompleted(callbackValue) {
		if (!this.ui.isInCombat) return;
		if (callbackValue === CALLBACK_MONSTERATTACK) this.monsterAttackCompleted();
		else if (callbackValue === CALLBACK_PLAYERATTACK) this.playerAttackCompleted();
	}
	monsterAttackCompleted() {
		if (this.lastAttackResult.targetDied) { this.controllers.mapController.handlePlayerDeath(); return; }
		this.handleNextMonsterAction();
	}
	startAttackEffect(attack, position, callbackValue) {
		if (this.controllers.preferences.attackspeed_milliseconds <= 0) { this.onVisualEffectCompleted(callbackValue); return; }
		const display = attack.damage === 0 ? null : Format.localizeInt(attack.damage);
		this.controllers.effectController.startEffect(position, 'redSplash', display, this, callbackValue);
	}
	startMissedEffect(attack, position, callbackValue) {
		if (this.controllers.preferences.attackspeed_milliseconds <= 0) { this.onVisualEffectCompleted(callbackValue); return; }
		this.controllers.effectController.startEffect(position, 'miss', getString('combat_miss_animation_message'), this, callbackValue);
	}
	endMonsterTurn() {
		this.currentActiveMonster = null;
		this.newPlayerTurn(false);
	}
	newPlayerTurn(isFirstRound) {
		if (this.canExitCombat()) { this.exitCombat(true); return; }
		this.controllers.actorStatsController.setActorMaxAP(this.world.model.player);
		if (!isFirstRound) this.controllers.gameRoundController.onNewPlayerRound();
		this.ui.isPlayersCombatTurn = true;
		this.combatTurnListeners.emit('onNewPlayerTurn');
	}
	static hasCriticalAttack(attacker, target) {
		if (!attacker.hasCriticalAttacks()) return false;
		return !target.isImmuneToCriticalHits();
	}
	static getAverageDamagePerHit(attacker, target) {
		const dp = attacker.getDamagePotential();
		const num = dp.max - dp.current + 1;
		let avgNon = 0;
		for (let n = 0; n < num; n++) avgNon += Math.max(0, n + dp.current - target.getDamageResistance()) / num;
		let avgCrit = 0, eff = 0;
		if (CombatController.hasCriticalAttack(attacker, target)) eff = attacker.getEffectiveCriticalChance();
		if (eff > 0) {
			for (let n = 0; n < num; n++) avgCrit += Math.max(0, Math.floor((n + dp.current) * attacker.getCriticalMultiplier()) - target.getDamageResistance()) / num;
		}
		const perStrike = (1 - eff / 100) * avgNon + eff * avgCrit / 100;
		return CombatController.getAttackHitChance(attacker, target) * perStrike / 100;
	}
	static getAverageDamagePerTurn(a, t) { return CombatController.getAverageDamagePerHit(a, t) * a.getAttacksPerTurn(); }
	static getTurnsToKillTarget(attacker, target) {
		if (CombatController.hasCriticalAttack(attacker, target)) {
			if (attacker.getDamagePotential().max * attacker.getCriticalMultiplier() <= target.getDamageResistance()) return 999;
		} else if (attacker.getDamagePotential().max <= target.getDamageResistance()) return 999;
		const avg = CombatController.getAverageDamagePerTurn(attacker, target);
		if (avg <= 0) return 100;
		return Math.ceil(target.getMaxHP() / avg);
	}
	getMonsterDifficulty(monster) {
		const tm = CombatController.getTurnsToKillTarget(this.world.model.player, monster);
		if (tm >= 999) return 0;
		const tp = CombatController.getTurnsToKillTarget(monster, this.world.model.player);
		const r = 50 + (tp - tm) * 2;
		if (r <= 1) return 1;
		if (r > 100) return 100;
		return r;
	}
	static getAttackHitChance(attacker, target) {
		const c = attacker.getAttackChance() - target.getBlockChance();
		return toInt(50 * (1 + two_divided_by_PI * Math.atan((c - n_) / F_)));
	}
	attack(attacker, target) {
		const hitChance = CombatController.getAttackHitChance(attacker, target);
		if (!Constants.roll100(hitChance)) {
			this.applyAttackMissStatusEffects(attacker, target);
			return AttackResult.MISS;
		}
		let damage = Constants.rollValue(attacker.getDamagePotential());
		let isCrit = false;
		if (CombatController.hasCriticalAttack(attacker, target)) {
			isCrit = Constants.roll100(attacker.getEffectiveCriticalChance());
			if (isCrit) damage = toInt(damage * attacker.getCriticalMultiplier());
		}
		damage -= target.getDamageResistance();
		if (damage < 0) damage = 0;
		this.controllers.actorStatsController.removeActorHealth(target, damage);
		this.applyAttackHitStatusEffects(attacker, target);
		return new AttackResult(true, isCrit, damage, target.isDead());
	}
	applyAttackHitStatusEffects(attacker, target) {
		const onHit = attacker.getOnHitEffects();
		const onHitRecv = target.getOnHitReceivedEffects();
		if (onHit) for (const e of onHit) this.controllers.actorStatsController.applyUseEffect(attacker, target, e);
		if (onHitRecv) for (const e of onHitRecv) this.controllers.actorStatsController.applyHitReceivedEffect(target, attacker, e);
	}
	applyAttackMissStatusEffects(attacker, target) {
		const onMiss = attacker.getOnMissEffects();
		const onMissRecv = target.getOnMissReceivedEffects();
		if (onMiss) for (const e of onMiss) this.controllers.actorStatsController.applyUseEffect(attacker, target, e);
		if (onMissRecv) for (const e of onMissRecv) this.controllers.actorStatsController.applyHitReceivedEffect(target, attacker, e);
	}
	endOfCombatRound() {
		this.world.model.worldData.tickWorldTime();
		this.controllers.gameRoundController.resetRoundTimers();
		this.controllers.actorStatsController.applyConditionsToPlayer(this.world.model.player, false);
		this.controllers.actorStatsController.applyConditionsToMonsters(this.world.model.currentMaps.map, true);
	}
	monsterSteppedOnPlayer(m) {
		this.setCombatSelection(m);
		this.enterCombat(BeginTurnAs.monsters);
	}
	startFlee() {
		this.setCombatSelection(null, null);
		this.combatActionListeners.emit('onPlayerStartedFleeing');
	}
}
