// Port of controller/MonsterMovementController.java + PathFinder.java
import { Coord, CoordRect, Constants, ListOfListeners, rnd, idiv } from '../util.js';
import { SC } from '../model.js';

export class PathFinder {
	constructor(maxWidth, maxHeight, map) {
		this.maxWidth = maxWidth;
		this.maxHeight = maxHeight;
		this.map = map;
		this.visited = new Uint8Array(maxWidth * maxHeight);
		const n = maxWidth * maxHeight;
		this.xs = new Int32Array(n); this.ys = new Int32Array(n); this.ws = new Int32Array(n);
		this.maxIndex = n - 1; this.lastIndex = -1; this.frontIndex = 0;
	}
	_reset() { this.lastIndex = -1; this.frontIndex = 0; }
	_push(x, y, w) {
		if (this.lastIndex === this.maxIndex) return;
		++this.lastIndex;
		this.xs[this.lastIndex] = x; this.ys[this.lastIndex] = y; this.ws[this.lastIndex] = w;
	}
	_popFirst(dest) {
		let i = this.frontIndex, lowIdx = i, low = this.ws[i];
		for (++i; i <= this.lastIndex; ++i) {
			if (this.ws[i] === -1) continue;
			if (this.ws[i] < low) { lowIdx = i; low = this.ws[i]; }
		}
		dest.x = this.xs[lowIdx]; dest.y = this.ys[lowIdx];
		this.ws[lowIdx] = -1;
		while (this.frontIndex <= this.lastIndex && this.ws[this.frontIndex] === -1) ++this.frontIndex;
		return low;
	}
	_isEmpty() { return this.frontIndex > this.lastIndex; }
	findPathBetween(from, to, nextStep, m) {
		let iterations = 0;
		if (from.contains(to)) return false;
		const measure = from.topLeft;
		const p = nextStep.topLeft;
		this.visited.fill(0);
		this._reset();
		this._push(to.x, to.y, 0);
		if (to.x >= 0 && to.y >= 0 && to.x < this.maxWidth && to.y < this.maxHeight) this.visited[to.y * this.maxWidth + to.x] = 1;
		while (!this._isEmpty()) {
			this._popFirst(p);
			if (++iterations > 100) return false;
			if (from.isAdjacentTo(p)) return true;
			p.x -= 1; this._visit(nextStep, measure, m);
			p.x += 2; this._visit(nextStep, measure, m);
			p.x -= 1; p.y -= 1; this._visit(nextStep, measure, m);
			p.y += 2; this._visit(nextStep, measure, m);
			p.x -= 1; this._visit(nextStep, measure, m);
			p.x += 2; this._visit(nextStep, measure, m);
			p.y -= 2; this._visit(nextStep, measure, m);
			p.x -= 2; this._visit(nextStep, measure, m);
		}
		return false;
	}
	_visit(r, measure, m) {
		const x = r.topLeft.x, y = r.topLeft.y;
		if (x < 0 || y < 0 || x >= this.maxWidth || y >= this.maxHeight) return;
		const i = y * this.maxWidth + x;
		if (this.visited[i]) return;
		this.visited[i] = 1;
		if (!this.map.isWalkable(r, m)) return;
		const dx = measure.x - x, dy = measure.y - y;
		this._push(x, y, dx * dx + dy * dy);
	}
}

const sgn = (i) => (i <= -1 ? -1 : i >= 1 ? 1 : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class MonsterMovementController {
	constructor(controllers, world) {
		this.controllers = controllers;
		this.world = world;
		this.monsterMovementListeners = new ListOfListeners();
		this.pathfinder = new PathFinder(Constants.MAX_MAP_WIDTH, Constants.MAX_MAP_HEIGHT, this);
	}
	moveMonsters() {
		const now = Date.now();
		for (const a of this.world.model.currentMaps.map.spawnAreas) {
			for (const m of [...a.monsters]) if (m.nextActionTime <= now) this.moveMonster(m, a);
		}
	}
	attackWithAgressiveMonsters() {
		const player = this.world.model.player;
		for (const a of this.world.model.currentMaps.map.spawnAreas) {
			for (const m of a.monsters) {
				if (!m.isAgressive(player)) continue;
				if (!m.isAdjacentTo(player)) continue;
				const bias = player.getSkillLevel('evasion') * SC.PER_SKILLPOINT_INCREASE_EVASION_MONSTER_ATTACK_CHANCE_PERCENTAGE;
				if (Constants.roll100(Constants.MONSTER_AGGRESSION_CHANCE_PERCENT - bias)) {
					this.monsterMovementListeners.emit('onMonsterSteppedOnPlayer', m);
					this.controllers.combatController.monsterSteppedOnPlayer(m);
					return;
				}
			}
		}
	}
	static monsterCanMoveTo(moving, map, tilemap, p, ignoreAreas) {
		if (tilemap != null && !tilemap.isWalkable(p)) return false;
		if (map.getMonsterAt(p, moving) != null) return false;
		if (!ignoreAreas) {
			for (const o of map.eventObjects) {
				if (o == null || !o.isActive) continue;
				if (!o.position.intersects(p)) continue;
				if (o.type === 'newmap' || o.type === 'keyarea' || o.type === 'rest') return false;
			}
		}
		return true;
	}
	moveMonster(m, area) {
		if (m.getMoveCost() === Constants.MONSTER_IMMOBILE_MOVE_COST) return;
		const map = this.world.model.currentMaps.map;
		const tileMap = this.world.model.currentMaps.tileMap;
		m.nextActionTime = Date.now() + MonsterMovementController.getMillisecondsPerMove(m);
		if (m.movementDestination != null && m.position.equals(m.movementDestination)) {
			MonsterMovementController.cancelCurrentMonsterMovement(m);
			return;
		}
		this.determineMonsterNextPosition(m, area, this.world.model.player.position);
		if (!MonsterMovementController.monsterCanMoveTo(m, map, tileMap, m.nextPosition, area.ignoreAreas)) {
			MonsterMovementController.cancelCurrentMonsterMovement(m);
			return;
		}
		if (m.nextPosition.contains(this.world.model.player.position)) {
			if (!m.isAgressive(this.world.model.player)) { MonsterMovementController.cancelCurrentMonsterMovement(m); return; }
			this.monsterMovementListeners.emit('onMonsterSteppedOnPlayer', m);
			this.controllers.combatController.monsterSteppedOnPlayer(m);
		} else {
			this.moveMonsterToNextPosition(m, map);
		}
	}
	determineMonsterNextPosition(m, area, playerPosition) {
		const t = m.getMovementAggressionType();
		if ((t === 'protectSpawn' && area.area.contains(playerPosition)) || t === 'wholeMap') {
			if (this.findPathFor(m, playerPosition)) return;
		} else if (t === 'flee') {
			const size = this.world.model.currentMaps.map.size;
			m.movementDestination = new Coord(playerPosition);
			m.movementDestination.x = clamp(2 * m.position.x - playerPosition.x, 0, size.width - 1);
			m.movementDestination.y = clamp(2 * m.position.y - playerPosition.y, 0, size.height - 1);
		}
		if (m.movementDestination == null) {
			m.movementDestination = new Coord(m.position);
			if (rnd.nextBoolean()) m.movementDestination.x = area.area.topLeft.x + rnd.nextInt(area.area.size.width);
			else m.movementDestination.y = area.area.topLeft.y + rnd.nextInt(area.area.size.height);
		}
		m.nextPosition.topLeft.set(
			m.position.x + sgn(m.movementDestination.x - m.position.x),
			m.position.y + sgn(m.movementDestination.y - m.position.y));
	}
	static cancelCurrentMonsterMovement(m) {
		m.movementDestination = null;
		m.nextActionTime = Date.now() + MonsterMovementController.getMillisecondsPerMove(m) * Constants.rollValue(Constants.monsterWaitTurns);
	}
	static getMillisecondsPerMove(m) {
		return idiv(Constants.MONSTER_MOVEMENT_TURN_DURATION_MS * m.getMoveCost(), Math.max(1, m.getMaxAP()));
	}
	getMillisecondsPerCombatMove() {
		const ms = this.controllers.preferences.attackspeed_milliseconds;
		return ms <= 0 ? 0 : ms;
	}
	findPathFor(m, to) { return this.pathfinder.findPathBetween(m.rectPosition, to, m.nextPosition, m); }
	isWalkable(r, m) {
		return MonsterMovementController.monsterCanMoveTo(null, this.world.model.currentMaps.map, this.world.model.currentMaps.tileMap, r, m.area.ignoreAreas);
	}
	moveMonsterToNextPosition(m, map) {
		this.moveMonsterToNextPositionWithCallback(m, map, idiv(MonsterMovementController.getMillisecondsPerMove(m), 4), null);
	}
	moveMonsterToNextPositionDuringCombat(m, map, callback) {
		this.moveMonsterToNextPositionWithCallback(m, map, idiv(this.getMillisecondsPerCombatMove(m), 4), callback);
	}
	moveMonsterToNextPositionWithCallback(m, map, duration, callback) {
		const prev = new CoordRect(new Coord(m.position), m.rectPosition.size);
		m.lastPosition.set(prev.topLeft);
		m.position.set(m.nextPosition.topLeft);
		this.controllers.effectController.startActorMoveEffect(m, map, prev.topLeft, m.position, duration, {
			onVisualEffectCompleted: (v) => {
				if (callback != null) callback.onVisualEffectCompleted(v);
				this.monsterMovementListeners.emit('onMonsterMoved', map, m, prev);
			},
		}, 0);
	}
}

export class MonsterSpawningController {
	constructor(controllers, world) {
		this.controllers = controllers;
		this.world = world;
		this.monsterSpawnListeners = new ListOfListeners();
	}
	spawnAllInArea(map, tileMap, area, respawnUnique) {
		let guard = 0;
		while (area.isSpawnable(respawnUnique) && guard++ < 1000) {
			if (!this.spawnInArea(map, tileMap, area, null)) break;
		}
		this.controllers.actorStatsController.healAllMonsters(area);
	}
	maybeSpawn(map, tileMap) {
		for (const a of map.spawnAreas) {
			if (!a.isSpawnable(false)) continue;
			if (!a.rollShouldSpawn()) continue;
			this.spawnInArea(map, tileMap, a, this.world.model.player.position);
		}
	}
	spawnAll(map, tileMap) {
		const respawnUnique = !map.visited;
		for (const a of map.spawnAreas) this.spawnAllInArea(map, tileMap, a, respawnUnique);
	}
	spawnInArea(map, tileMap, a, playerPosition, type) {
		if (!type) type = a.getRandomMonsterType(this.world);
		if (!type) return false;
		const p = MonsterSpawningController.getRandomFreePosition(map, tileMap, a, type.tileSize, playerPosition);
		if (p == null) return false;
		const m = a.spawn(p, type);
		this.monsterSpawnListeners.emit('onMonsterSpawned', map, m);
		return true;
	}
	static getRandomFreePosition(map, tileMap, a, requiredSize, playerPosition) {
		const p = new CoordRect(requiredSize);
		for (let i = 0; i < 100; ++i) {
			p.topLeft.set(a.area.topLeft.x + rnd.nextInt(a.area.size.width), a.area.topLeft.y + rnd.nextInt(a.area.size.height));
			if (!MonsterMovementController.monsterCanMoveTo(null, map, tileMap, p, a.ignoreAreas)) continue;
			if (playerPosition != null && p.contains(playerPosition)) continue;
			return p.topLeft;
		}
		return null;
	}
	remove(map, m) {
		for (const a of map.spawnAreas) a.remove(m);
		this.monsterSpawnListeners.emit('onMonsterRemoved', map, m, m.rectPosition);
	}
	activateSpawnArea(map, tileMap, area, spawnAll) {
		area.isSpawning = true;
		if (spawnAll) this.spawnAllInArea(map, tileMap, area, true);
	}
	deactivateSpawnArea(area, removeAll) {
		area.isSpawning = false;
		if (removeAll) area.removeAllMonsters();
	}
}
