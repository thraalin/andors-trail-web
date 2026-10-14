// Port of controller/MovementController.java
import { Coord, Constants, ListOfListeners, TimedMessageTask, L, idiv } from '../util.js';
import { MapBundle } from '../model.js';
import { MonsterSpawningController } from './MonsterMovementController.js';
import { PauseReason } from './GameRoundController.js';

const sgn = (v) => (v === 0 ? 0 : v > 0 ? 1 : -1);
const abs = Math.abs;

export class MovementController {
	constructor(controllers, world) {
		this.controllers = controllers;
		this.world = world;
		this.movementHandler = new TimedMessageTask(this, Constants.MINIMUM_INPUT_INTERVAL, false);
		this.mapTransitionInProgress = false;
		this.playerMovementListeners = new ListOfListeners();
		this.movementDx = 0;
		this.movementDy = 0;
		this.movementDestination = null;
	}
	placePlayerAsyncAt(objectType, mapName, placeName, offsetX, offsetY) {
		this.controllers.gameRoundController.acquirePause(PauseReason.MAP_TRANSITION);
		this.mapTransitionInProgress = true;
		this.stopMovement();
		const p = (async () => {
			let failed = false;
			try {
				await this.placePlayerAt(objectType, mapName, placeName, offsetX, offsetY);
			} catch (e) {
				console.error('Map transition failed', e);
				failed = true;
			}
			this.stopMovement();
			this.controllers.gameRoundController.releasePause(PauseReason.MAP_TRANSITION);
			this.mapTransitionInProgress = false;
			if (!failed) this.playerMovementListeners.emit('onPlayerEnteredNewMap', this.world.model.currentMaps.map, this.world.model.player.position);
		})();
		this.lastTransition = p;
		return p;
	}
	async placePlayerAt(objectType, mapName, placeName, offsetX, offsetY) {
		if (mapName == null || placeName == null) return;
		const newMap = this.world.maps.findPredefinedMap(mapName);
		if (newMap == null) { L.log('Cannot find map ' + mapName); return; }
		const place = newMap.findEventObject(objectType, placeName);
		if (place == null) { L.log('Cannot find place ' + placeName + ' of type ' + objectType + ' in map ' + mapName); return; }
		if (!place.isActive) { L.log('Place ' + placeName + ' inactive in ' + mapName); return; }
		// Load the layer data first (async) so the model switch below happens atomically.
		const mapTiles = await this.world.mapLoader.loadLayeredTileMap(newMap);
		const model = this.world.model;
		model.player.position.set(place.position.topLeft);
		model.player.position.x += Math.min(offsetX, place.position.size.width - 1);
		model.player.position.y += Math.min(offsetY, place.position.size.height - 1);
		model.player.lastPosition.set(model.player.position);
		if (!newMap.visited) { newMap.createAllContainerLoot(); this.world.maps.worldMapRequiresUpdate = true; }
		if (model.currentMaps.map != null && !model.currentMaps.map.hasResetTemporaryData()) model.currentMaps.map.updateLastVisitTime();
		this.prepareMapAsCurrentMap(newMap, true, mapTiles);
	}
	// mapTiles must be pre-loaded (see world.mapLoader)
	prepareMapAsCurrentMap(newMap, spawnMonsters, mapTiles) {
		const model = this.world.model;
		const nm = new MapBundle();
		nm.map = newMap;
		mapTiles.changeColorFilter(newMap.currentColorFilter);
		nm.tileMap = mapTiles;
		nm.tiles = null;
		model.currentMaps = nm;
		this.controllers.mapController.applyCurrentMapReplacements(false);
		if (spawnMonsters && !newMap.isRecentlyVisited()) this.controllers.monsterSpawnController.spawnAll(newMap, nm.tileMap);
		this.controllers.mapController.prepareScriptsOnCurrentMap();
		newMap.visited = true;
		newMap.updateLastVisitTime();
		this.moveBlockedActors(newMap, nm.tileMap);
		this.controllers.effectController.updateSplatters(newMap);
	}
	mayMovePlayer() { return !this.world.model.uiSelections.isInCombat; }
	movePlayer(dx, dy) {
		if (dx === 0 && dy === 0) return;
		if (!this.mayMovePlayer()) return;
		if (!this.world.model.currentMaps.tileMap) return;
		if (!this._findWalkablePosition(dx, dy)) return;
		const m = this.world.model.currentMaps.map.getMonsterAt(this.world.model.player.nextPosition);
		if (m != null) {
			this.controllers.mapController.steppedOnMonster(m, new Coord(this.world.model.player.nextPosition));
			return;
		}
		this.moveToNextIfPossible();
	}
	_findWalkablePosition(dx, dy) {
		const agg = this.controllers.preferences.movementAggressiveness;
		if (this.findWalkablePosition(dx, dy, agg)) return true;
		if (agg === 'normal') return false;
		return this.findWalkablePosition(dx, dy, 'normal');
	}
	findWalkablePosition(dx, dy, aggressiveness) {
		if (this.controllers.preferences.movementMethod === 'straight') return this.findWalkablePosition_straight(dx, dy, aggressiveness);
		return this.findWalkablePosition_directional(dx, dy, aggressiveness);
	}
	findWalkablePosition_straight(dx, dy, a) {
		if (this.tryWalkablePosition(sgn(dx), sgn(dy), a)) return true;
		if (dx === 0 || dy === 0) return false;
		if (abs(dx) === abs(dy) && this.tryWalkablePosition(sgn(dx), 0, a)) return true;
		if (abs(dx) > abs(dy)) return this.tryWalkablePosition(sgn(dx), 0, a);
		return this.tryWalkablePosition(0, sgn(dy), a);
	}
	findWalkablePosition_directional(dx, dy, a) {
		if (this.tryWalkablePosition(sgn(dx), sgn(dy), a)) return true;
		if (dx === 0) return this.tryWalkablePosition(1, sgn(dy), a) || this.tryWalkablePosition(-1, sgn(dy), a);
		if (dy === 0) return this.tryWalkablePosition(sgn(dx), 1, a) || this.tryWalkablePosition(sgn(dx), -1, a);
		if (abs(dx) >= abs(dy)) return this.tryWalkablePosition(sgn(dx), 0, a) || this.tryWalkablePosition(0, sgn(dy), a);
		return this.tryWalkablePosition(0, sgn(dy), a) || this.tryWalkablePosition(sgn(dx), 0, a);
	}
	tryWalkablePosition(dx, dy, aggressiveness) {
		const player = this.world.model.player;
		player.nextPosition.set(player.position.x + dx, player.position.y + dy);
		if (!this.world.model.currentMaps.tileMap.isWalkable(player.nextPosition)) return false;
		if (aggressiveness === 'normal') return true;
		const m = this.world.model.currentMaps.map.getMonsterAt(player.nextPosition);
		if (m != null && !m.isAgressive(player)) return true;
		if (aggressiveness === 'aggressive' && m == null) return false;
		if (aggressiveness === 'defensive' && m != null) return false;
		return true;
	}
	moveToNextIfPossible() {
		const player = this.world.model.player;
		const currentMap = this.world.model.currentMaps.map;
		const newPosition = new Coord(player.nextPosition);
		for (const o of currentMap.eventObjects) {
			if (!o.isActive) continue;
			if (o.type === 'keyarea' && o.position.contains(newPosition)) {
				if (!this.controllers.mapController.canEnterKeyArea(o)) return;
			}
		}
		player.lastPosition.set(player.position);
		player.position.set(newPosition);
		this.controllers.combatController.setCombatSelection(null, null);
		this.controllers.effectController.startActorMoveEffect(player, currentMap, player.lastPosition, newPosition, idiv(Constants.MINIMUM_INPUT_INTERVAL, 2), {
			onVisualEffectCompleted: () => {
				this.playerMovementListeners.emit('onPlayerMoved', currentMap, newPosition, player.lastPosition);
				this.controllers.mapController.handleMapEventsAfterMovement(currentMap, newPosition, player.lastPosition);
				if (!this.world.model.uiSelections.isInCombat) {
					const loot = this.world.model.currentMaps.map.getBagAt(newPosition);
					if (loot != null) this.controllers.itemController.playerSteppedOnLootBag(loot);
				}
			},
		}, 0);
	}
	async respawnPlayer() {
		const p = this.world.model.player;
		await this.placePlayerAt('rest', p.getSpawnMap(), p.getSpawnPlace(), 0, 0);
		this.playerMovementListeners.emit('onPlayerEnteredNewMap', this.world.model.currentMaps.map, p.position);
	}
	respawnPlayerAsync() {
		const p = this.world.model.player;
		return this.placePlayerAsyncAt('rest', p.getSpawnMap(), p.getSpawnPlace(), 0, 0);
	}
	isMapTransitionInProgress() { return this.mapTransitionInProgress; }
	moveBlockedActors(map, tileMap) {
		const model = this.world.model;
		if (!tileMap.isWalkable(model.player.position)) {
			const p = MovementController.getFirstMapChangeAreaPosition(map);
			if (p != null) model.player.position.set(p);
		}
		const pp = model.player.position;
		for (const a of map.spawnAreas) {
			for (const m of a.monsters) {
				if (tileMap.isWalkable(m.rectPosition)) continue;
				const p = MonsterSpawningController.getRandomFreePosition(map, tileMap, a, m.tileSize, pp);
				if (p == null) continue;
				m.position.set(p);
			}
		}
		for (const bag of map.groundBags) {
			if (tileMap.isWalkable(bag.position)) continue;
			const p = MovementController.getFirstMapChangeAreaPosition(map);
			if (p == null) continue;
			if (tileMap.isWalkable(new Coord(p.x + 1, p.y))) bag.position.set(p.x + 1, p.y);
			else if (tileMap.isWalkable(new Coord(p.x, p.y + 1))) bag.position.set(p.x, p.y + 1);
			else if (tileMap.isWalkable(new Coord(p.x - 1, p.y))) bag.position.set(p.x - 1, p.y);
			else if (tileMap.isWalkable(new Coord(p.x, p.y - 1))) bag.position.set(p.x, p.y - 1);
		}
	}
	static getFirstMapChangeAreaPosition(map) {
		for (const o of map.eventObjects) if (o.isActive && o.type === 'newmap') return o.position.topLeft;
		return null;
	}
	startMovement(dx, dy, destination) {
		if (!this.mayMovePlayer()) return;
		if (dx === 0 && dy === 0) return;
		this.movementDx = dx;
		this.movementDy = dy;
		this.movementDestination = destination;
		this.movementHandler.start();
	}
	stopMovement() { this.movementHandler.stop(); }
	onTick() {
		if (!this.world.model.uiSelections.isMainActivityVisible) return false;
		if (this.world.model.uiSelections.isInCombat) return false;
		// Web addition: when the player tapped a destination tile, follow a shortest path to it
		// (re-planned every step so wandering monsters are routed around) and stop on arrival.
		if (this.movementDestination) {
			const pp = this.world.model.player.position, dest = this.movementDestination;
			if (pp.x === dest.x && pp.y === dest.y) return false;
			const step = this.nextStepToward(dest);
			if (step) {
				this.movementDx = step.dx; this.movementDy = step.dy;
			} else {
				// Can't get any closer. If the target is right next to us (an NPC, a door, a sign),
				// step into it once so it triggers, then stop.
				const dx = dest.x - pp.x, dy = dest.y - pp.y;
				if (Math.max(abs(dx), abs(dy)) === 1 && this.world.model.currentMaps.tileMap.isWalkable(dest.x, dest.y)) this.movePlayer(dx, dy);
				return false;
			}
		}
		const before = new Coord(this.world.model.player.position);
		this.movePlayer(this.movementDx, this.movementDy);
		if (this.movementDestination && this.world.model.player.position.equals(before)) return false; // blocked
		return true;
	}
	// Breadth-first search over walkable tiles (8 directions, like player movement). Monsters, map exits
	// and key areas count as obstacles unless they are the destination, so a walk never leaves the map
	// or bumps into someone by accident. If the destination can't be reached (a wall, a tree), the walk
	// goes to the reachable tile closest to it. Each step strictly shortens the remaining path, so the
	// hero can no longer bounce back and forth.
	nextStepToward(dest) {
		const cm = this.world.model.currentMaps, map = cm.map, tm = cm.tileMap;
		if (!map || !tm) return null;
		const W = map.size.width, H = map.size.height, p = this.world.model.player.position;
		const isDest = (x, y) => x === dest.x && y === dest.y;
		const special = map.eventObjects.filter((o) => o.isActive && (o.type === 'newmap' || o.type === 'keyarea'));
		const blocked = (x, y) => {
			if (x < 0 || y < 0 || x >= W || y >= H) return true;
			if (!tm.isWalkable(x, y)) return true;
			if (isDest(x, y)) return false;
			if (map.getMonsterAt(x, y)) return true;
			for (const o of special) if (o.position.contains(x, y)) return true;
			return false;
		};
		const cheb = (x, y) => Math.max(abs(dest.x - x), abs(dest.y - y));
		const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
		const start = p.y * W + p.x;
		const prev = new Int32Array(W * H).fill(-2);
		prev[start] = -1;
		const queue = [start];
		let best = start, bestD = cheb(p.x, p.y);
		for (let qi = 0; qi < queue.length; qi++) {
			const cur = queue[qi], cx = cur % W, cy = (cur - cx) / W;
			if (isDest(cx, cy)) { best = cur; break; }
			const d = cheb(cx, cy);
			if (d < bestD) { bestD = d; best = cur; }
			// try the directions that point at the target first, so equal-length paths look natural
			const order = dirs.slice().sort((a, b) => cheb(cx + a[0], cy + a[1]) - cheb(cx + b[0], cy + b[1]));
			for (const [dx, dy] of order) {
				const nx = cx + dx, ny = cy + dy;
				if (blocked(nx, ny)) continue;
				const n = ny * W + nx;
				if (prev[n] !== -2) continue;
				prev[n] = cur;
				queue.push(n);
			}
		}
		if (best === start) return null;
		let n = best;
		while (prev[n] !== start) n = prev[n];
		const nx = n % W, ny = (n - nx) / W;
		return { dx: nx - p.x, dy: ny - p.y };
	}
	static refreshMonsterAggressiveness() { /* faction aggressiveness is dynamic in the original */ }
	static hasAdjacentAggressiveMonster(map, player) { return MovementController.getAdjacentAggressiveMonster(map, player) != null; }
	static getAdjacentAggressiveMonster(map, player) {
		if (!map) return null;
		for (const a of map.spawnAreas) for (const m of a.monsters) {
			if (!m.isAgressive(player)) continue;
			if (m.isAdjacentTo(player)) return m;
		}
		return null;
	}
}
