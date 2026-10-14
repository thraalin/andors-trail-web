// Headless engine test: load content, start a new game, walk, talk, fight, save/load.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run from anywhere: node tools/test_headless.mjs
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.fetch = async (url) => {
	const p = path.join(ROOT, url);
	const txt = fs.readFileSync(p, 'utf8');
	return { ok: true, json: async () => JSON.parse(txt), text: async () => txt };
};
const store = new Map();
globalThis.localStorage = {
	getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
	removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i], get length() { return store.size; },
};

const { WorldContext, ControllerContext, Preferences, createNewWorld, Savegames } = await import(ROOT + '/js/context.js');
const { loadAllResources } = await import(ROOT + '/js/resource/ResourceLoader.js');
const { initStrings, getString } = await import(ROOT + '/js/strings.js');
const { TileManager } = await import(ROOT + '/js/resource/TileManager.js');
const { ConversationStatemachine } = await import(ROOT + '/js/controller/ConversationController.js');

const t0 = Date.now();
const content = JSON.parse(fs.readFileSync(ROOT + '/data/content.json', 'utf8'));
initStrings(content.strings, content.plurals, content.arrays);
const world = new WorldContext();
loadAllResources(world, content);
console.log('loaded in', Date.now() - t0, 'ms',
	'items', world.itemTypes.itemTypes.size, 'monsters', world.monsterTypes.monsterTypesById.size,
	'maps', world.maps.predefinedMaps.size, 'quests', world.quests.quests.size, 'maxTile', world.tileManager.tileCache.getMaxTileID());
// Sanity: icon constants
const tc = world.tileManager.tileCache;
const desc = (id) => { const t = tc.getTile(id); return t ? t.tileset.tilesetName + ':' + t.localID : 'none'; };
console.log('hero', desc(TileManager.CHAR_HERO), 'sel_red', desc(TileManager.iconID_selection_red), 'bag', desc(TileManager.iconID_groundbag),
	'immunity', desc(TileManager.iconID_immunity_overlay), 'placeholder_boots', desc(TileManager.tileID_placeholder_boots));

const prefs = new Preferences();
prefs.attackspeed_milliseconds = 0; // instant combat for test
prefs.confirmAttack = false;
prefs.confirmRest = false;
prefs.enableUiAnimations = false;
const controllers = new ControllerContext(world, prefs);
const events = [];
const clog = [];
controllers.combatController.combatActionListeners.add(new Proxy({}, { get: (t, k) => (...a) => clog.push(k) }));
controllers.mapController.worldEventListeners.add(new Proxy({}, { get: (t, k) => (...a) => events.push([k, a.map((x) => (x && x.name) || (x && x.id) || x)]) }));

await createNewWorld(world, controllers, 'Tester', TileManager.CHAR_HERO);
controllers.gameRoundController.onMainActivityResumed();
const p = world.model.player;
console.log('player on', world.model.currentMaps.map.name, p.position.toString(), 'hp', p.health.toString(), 'ap', p.ap.toString(),
	'gold', p.inventory.gold, 'items', p.inventory.items.map((e) => e.itemType.id + 'x' + e.quantity).join(','));
console.log('worn', p.inventory.wear.map((t) => (t ? t.id : '-')).join(','), 'atk', p.attackChance, 'dmg', p.damagePotential.toString(), 'bc', p.blockChance);
console.log('home objects', world.model.currentMaps.map.eventObjects.map((o) => o.type + ':' + (o.id || '') + '@' + o.position.topLeft).join(' '));
console.log('monsters', world.model.currentMaps.map.spawnAreas.flatMap((a) => a.monsters.map((m) => m.monsterType.id + '@' + m.position)).join(' '));

// Talk to Mikhail (first NPC)
const mik = world.model.currentMaps.map.spawnAreas.flatMap((a) => a.monsters)[0];
if (mik) {
	const lines = [];
	const sm = new ConversationStatemachine(world, controllers, {
		onTextPhraseReached: (msg) => lines.push('NPC: ' + msg),
		onConversationEnded: () => lines.push('[end]'),
		onConversationEndedWithShop: () => lines.push('[shop]'),
		onConversationEndedWithCombat: () => lines.push('[combat]'),
		onConversationEndedWithRemoval: () => lines.push('[removed]'),
		onScriptEffectsApplied: (r) => lines.push('[effects ' + r.questProgress.map(String).join(',') + ']'),
		onConversationCanProceedWithNext: () => { lines.push('[next]'); sm._next = true; },
		onConversationHasReply: (r, m) => { lines.push('  > ' + m); (sm._replies ||= []).push(r); },
	});
	sm.setCurrentNPC(mik);
	sm.proceedToPhrase(mik.getPhraseID(), true, true);
	for (let i = 0; i < 12; i++) {
		if (sm._next) { sm._next = false; sm._replies = []; sm.playerSelectedNextStep(); continue; }
		const r = sm._replies && sm._replies[0];
		if (!r) break;
		sm._replies = [];
		sm.playerSelectedReply(r);
	}
	console.log(lines.slice(0, 30).join('\n'));
	console.log('quests', [...p.questProgress.entries()].map(([k, s]) => k + ':' + [...s]).join(' '));
}

// Walk out of the house: find newmap object and step on it
const exit = world.model.currentMaps.map.eventObjects.find((o) => o.type === 'newmap');
await controllers.movementController.placePlayerAsyncAt('newmap', exit.map, exit.place, 0, 0);
console.log('now on', world.model.currentMaps.map.name, p.position.toString(), 'walkable here', world.model.currentMaps.tileMap.isWalkable(p.position));
console.log('monsters', world.model.currentMaps.map.spawnAreas.flatMap((a) => a.monsters.map((m) => m.monsterType.id)).length);

// Go to wild map with hostile monsters and fight one
const wild = world.maps.findPredefinedMap('crossglen');
const tiles = await world.mapLoader.loadLayeredTileMap(wild);
console.log('crossglen replacements', tiles.replacements ? tiles.replacements.length : 0, 'used tiles', tiles.usedTileIDs.size);
const fightMap = world.maps.findPredefinedMap('wild1');
await controllers.movementController.placePlayerAsyncAt('newmap', 'wild1', fightMap.eventObjects.find((o) => o.type === 'newmap').id, 0, 0);
const hostile = world.model.currentMaps.map.spawnAreas.flatMap((a) => a.monsters).find((m) => m.isAgressive(p));
console.log('on', world.model.currentMaps.map.name, 'hostile', hostile && hostile.name, hostile && hostile.health.toString());
if (hostile) {
	controllers.itemController.equipItem(world.itemTypes.getItemType(p.inventory.items.find((e) => e.itemType.isWeapon()).itemType.id), 'weapon');
	console.log('equipped club: atk', p.attackChance, 'dmg', p.damagePotential.toMinMaxString(), 'atkCost', p.attackCost);
	// teleport next to monster
	const mp = hostile.position;
	const tm = world.model.currentMaps.tileMap;
	const spot = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => [mp.x + dx, mp.y + dy]).find(([x, y]) => tm.isWalkable(x, y)) || [mp.x - 1, mp.y];
	p.position.set(spot[0], spot[1]);
	controllers.combatController.setCombatSelection(hostile);
	controllers.combatController.enterCombat('player');
	let rounds = 0;
	while (world.model.uiSelections.isInCombat && rounds++ < 200 && !p.isDead()) {
		controllers.combatController.executeMoveAttack(0, 0);
		if (world.model.uiSelections.isInCombat && !world.model.uiSelections.isPlayersCombatTurn) await new Promise((r) => setTimeout(r, 5));
		if (world.model.uiSelections.isInCombat && world.model.uiSelections.isPlayersCombatTurn && !controllers.combatController.playerHasApLeft()) controllers.combatController.endPlayerTurn();
	}
	console.log('combat over after', rounds, 'actions. monster hp', hostile.health.toString(), 'player hp', p.health.toString(), 'xp', p.totalExperience, 'gold', p.inventory.gold);
	console.log(world.model.combatLog.getAllMessages().slice(-6).join(' | '));
	console.log('combat actions', clog.slice(0, 20).join(','));
}
console.log('events', events.slice(-6).map((e) => e[0]).join(','));

// Save / load roundtrip
if (controllers.movementController.lastTransition) await controllers.movementController.lastTransition;
Savegames.saveWorld(world, 1);
const before = JSON.stringify(Savegames.serialize(world).player);
const r = await Savegames.loadWorld(world, controllers, 1);
const after = JSON.stringify(Savegames.serialize(world).player);
console.log('load', r, 'player identical', before === after, 'map', world.model.currentMaps.map.name);
if (before !== after) {
	const a = JSON.parse(before), b = JSON.parse(after);
	for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log('  differs:', k, JSON.stringify(a[k]).slice(0, 200), '=>', JSON.stringify(b[k]).slice(0, 200));
}
console.log('save size', localStorage.getItem('andorstrail.save.1').length);
console.log('sample strings:', getString('dialog_monsterloot_gainedexp', 12), '|', getString('combat_result_herohit', 'Rat', 5));
process.exit(0);
