// Port of resource/ResourceLoader + parsers + TMXMapTranslator + WorldMapParser + ConversationLoader
import { Coord, CoordRect, Size, Range, ConstRange, Constants, L } from '../util.js';
import {
	ActorConditionType, ActorConditionEffect, ActorCondition, StatsModifierTraits, AbilityModifierTraits,
	ItemCategory, ItemType, ItemFilter, DropList, DropItem, MonsterType, ItemTraits_OnUse, ItemTraits_OnHitReceived,
	ItemTraits_OnEquip, Quest, QuestLogEntry, Phrase, Reply, Requirement, ScriptEffect, QuestProgress,
	PredefinedMap, MapObject, MonsterSpawnArea, LayeredTileMap, MapLayer, MapSection, ReplaceableMapSection,
	WorldMapSegment, HeroCollection, RequirementType,
} from '../model.js';
import { TILESETS } from './tilesets.js';
import { DynamicTileLoader } from './TileManager.js';

// ------------------------------------------------------------- ResourceParserUtils
const zero_or_one = new ConstRange(1, 0), one = new ConstRange(1, 1), five = new ConstRange(5, 5), ten = new ConstRange(10, 10);
const CH = {
	'100': one, '70': new ConstRange(100, 70), '30': new ConstRange(100, 30), '25': new ConstRange(100, 25),
	'20': new ConstRange(100, 20), '10': new ConstRange(100, 10), '5': new ConstRange(100, 5), '1': new ConstRange(100, 1),
	'1/1000': new ConstRange(1000, 1), '1/10000': new ConstRange(10000, 1),
};
const parseIntDef = (s, d) => { if (s == null || s === '') return d; const n = parseInt(s, 10); return Number.isNaN(n) ? d : n; };
export const PU = {
	always: one,
	parseChance(v) {
		v = String(v);
		if (CH[v]) return CH[v];
		const c = v.indexOf('/');
		if (c >= 0) return new ConstRange(parseIntDef(v.substring(c + 1), 100), parseIntDef(v.substring(0, c), 1));
		return new ConstRange(100, parseIntDef(v, 10));
	},
	parseConstRange(o) { if (o == null) return null; return new ConstRange(o.max | 0, (o.min | 0)); },
	parseQuantity(o) {
		const min = o.min | 0, max = o.max | 0;
		if (min === 0 && max === 1) return zero_or_one;
		if (min === 1 && max === 1) return one;
		if (min === 5 && max === 5) return five;
		if (min === 10 && max === 10) return ten;
		return PU.parseConstRange(o);
	},
	parseStatsModifierTraits(o) {
		if (o == null) return null;
		const hp = PU.parseConstRange(o.increaseCurrentHP), ap = PU.parseConstRange(o.increaseCurrentAP);
		if (hp == null && ap == null) return null;
		return new StatsModifierTraits(o.visualEffectID || null, hp, ap);
	},
	parseAbilityModifierTraits(o) {
		if (o == null) return null;
		const dmg = PU.parseConstRange(o.increaseAttackDamage);
		const g = (k, d = 0) => (o[k] == null ? d : o[k] | 0);
		return new AbilityModifierTraits(
			g('increaseMaxHP'), g('increaseMaxAP'), g('increaseMoveCost'), g('increaseUseItemCost'), g('increaseReequipCost'),
			g('increaseAttackCost'), g('increaseAttackChance'), g('increaseBlockChance'),
			dmg ? dmg.current : 0, dmg ? dmg.max : 0, g('setNonWeaponDamageModifier', 100), g('increaseCriticalSkill'),
			o.setCriticalMultiplier == null ? 0 : Number(o.setCriticalMultiplier), g('increaseDamageResistance'));
	},
	parseImageID(loader, s) { const p = s.split(':'); return loader.prepareTileID(p[0], parseInt(p[1], 10)); },
	parseTilesetTileSize(loader, s, def) { if (!s) return def; return loader.getTilesetTileSize(s.split(':')[0]); },
};
const arr = (a, f) => { if (!a || a.length === 0) return null; const r = a.map(f).filter((x) => x != null); return r.length ? r : null; };

class ItemTraitsParser {
	constructor(conditionTypes) { this.ct = conditionTypes; }
	_cond(o) { return new ActorConditionEffect(this.ct.getActorConditionType(o.condition), o.magnitude == null ? ActorCondition.MAGNITUDE_REMOVE_ALL : o.magnitude | 0, o.duration == null ? ActorCondition.DURATION_NONE : o.duration | 0, PU.parseChance(o.chance)); }
	_condNoDur(o) { return new ActorConditionEffect(this.ct.getActorConditionType(o.condition), o.magnitude == null ? 1 : o.magnitude | 0, ActorCondition.DURATION_FOREVER, PU.always); }
	onUse(o) {
		if (o == null) return null;
		const hp = PU.parseConstRange(o.increaseCurrentHP), ap = PU.parseConstRange(o.increaseCurrentAP);
		const src = arr(o.conditionsSource, (x) => this._cond(x)), tgt = arr(o.conditionsTarget, (x) => this._cond(x));
		if (hp == null && ap == null && src == null && tgt == null) return null;
		return new ItemTraits_OnUse(new StatsModifierTraits(null, hp, ap), src, tgt);
	}
	onHitReceived(o) {
		if (o == null) return null;
		const hp = PU.parseConstRange(o.increaseCurrentHP), ap = PU.parseConstRange(o.increaseCurrentAP);
		const ahp = PU.parseConstRange(o.increaseAttackerCurrentHP), aap = PU.parseConstRange(o.increaseAttackerCurrentAP);
		const src = arr(o.conditionsSource, (x) => this._cond(x)), tgt = arr(o.conditionsTarget, (x) => this._cond(x));
		if (hp == null && ap == null && aap == null && src == null && tgt == null) return null;
		return new ItemTraits_OnHitReceived(new StatsModifierTraits(null, hp, ap), new StatsModifierTraits(null, ahp, aap), src, tgt);
	}
	onEquip(o) {
		if (o == null) return null;
		const stats = PU.parseAbilityModifierTraits(o);
		const conds = arr(o.addedConditions, (x) => this._condNoDur(x));
		if (stats == null && conds == null) return null;
		return new ItemTraits_OnEquip(stats, conds);
	}
}

function getExpectedMonsterExperience(attackCost, attackChance, dp, criticalSkill, criticalMultiplier, blockChance, damageResistance, hitEffect, maxHP, maxAP) {
	const avgDmg = dp != null ? dp.averagef() : 0;
	const attacksPerTurn = Math.floor(Math.trunc(maxAP / attackCost));
	const avgAttackHP = attacksPerTurn * (attackChance / 100) * avgDmg * (1 + (criticalSkill / 100) * criticalMultiplier);
	const avgDefenseHP = maxHP * (1 + blockChance / 100) + Constants.EXP_FACTOR_DAMAGERESISTANCE * damageResistance;
	let bonus = 0;
	if (hitEffect != null && hitEffect.addedConditions_target != null && hitEffect.addedConditions_target.length > 0) bonus += 50;
	// Java computes this in float precision; Math.fround keeps rounding identical for ceil()
	const f = Math.fround;
	const v = f(f(f(avgAttackHP) * 3 + f(avgDefenseHP)) * f(Constants.EXP_FACTOR_SCALING));
	return Math.ceil(v) + bonus;
}

function parseRequirement(o) {
	const type = o.requireType;
	const id = o.requireID == null ? null : String(o.requireID);
	return new Requirement(type,
		(type === 'random' || type === 'consumedBonemeals') ? null : id,
		o.value == null ? 0 : o.value | 0,
		!!o.negate,
		type === 'random' ? PU.parseChance(id) : null);
}
function parsePhrase(o) {
	let replies = null, effects = null;
	try {
		replies = arr(o.replies, (r) => new Reply(r.text == null ? '' : r.text, r.nextPhraseID, arr(r.requires, parseRequirement)));
		effects = arr(o.rewards, (e) => new ScriptEffect(e.rewardType, e.rewardID == null ? null : String(e.rewardID), e.value == null ? 0 : e.value | 0, e.mapName == null ? null : e.mapName, arr(e.requires, parseRequirement)));
	} catch (e) { console.warn('phrase parse', o.id, e); }
	return new Phrase(o.message == null ? null : o.message, replies, effects, o.switchToNPC == null ? null : o.switchToNPC);
}

// Lazily builds Phrase objects per conversation file (like the Android ConversationLoader)
export class ConversationLoader {
	constructor() { this.fileOfPhrase = new Map(); this.files = {}; this.cache = new Map(); this.loadedFiles = new Set(); }
	init(conversations) {
		this.files = conversations;
		for (const [file, list] of Object.entries(conversations)) for (const p of list) this.fileOfPhrase.set(p.id, file);
	}
	loadPhrase(phraseID) {
		if (this.cache.has(phraseID)) return this.cache.get(phraseID);
		const file = this.fileOfPhrase.get(phraseID);
		if (!file) return null;
		if (!this.loadedFiles.has(file)) {
			for (const p of this.files[file]) this.cache.set(p.id, parsePhrase(p));
			this.loadedFiles.add(file);
		}
		return this.cache.get(phraseID) || null;
	}
	hasPhrase(id) { return this.fileOfPhrase.has(id); }
}

export class VisualEffectCollection {
	constructor() { this.effects = {}; }
	initialize(loader) {
		const mk = (name, from, to, duration, color) => {
			const ids = [];
			for (let i = from; i < to; ++i) ids.push(loader.prepareTileID(name, i));
			const totalFrames = ids.length;
			const mspf = Math.trunc(duration / totalFrames);
			return { frameIconIDs: ids, duration, textColor: color, totalFrames, lastFrame: totalFrames - 1, millisecondPerFrame: mspf, fps: Math.trunc(1000 / mspf) };
		};
		this.effects.redSplash = mk('effect_blood4', 0, 14, 400, '#ff0000');
		this.effects.blueSwirl = mk('effect_heal2', 0, 16, 400, 'rgb(150,150,255)');
		this.effects.greenSplash = mk('effect_poison1', 0, 16, 400, '#00ff00');
		this.effects.miss = mk('effect_miss1', 0, 16, 400, '#888888');
	}
	getVisualEffect(id) { return this.effects[id] || this.effects.redSplash; }
}

// ------------------------------------------------------------- loading
export function loadAllResources(world, content, tileSize = 32) {
	const loader = new DynamicTileLoader(world.tileManager.tileCache);
	for (const [name, gw, gh, sw, sh] of TILESETS) loader.prepareTileset(name, new Size(gw, gh), new Size(sw, sh), tileSize);
	// Preloaded UI icons, in the same order as the Android loader so TileManager constants match.
	loader.prepareTileID('char_hero', 0);
	loader.prepareTileID('char_hero_maksiu_girl_01', 0);
	loader.prepareTileID('char_hero_maksiu_boy_01', 0);
	loader.prepareTileID('char_hero_boat', 0);
	loader.prepareTileID('char_hero_sheep', 0);
	loader.prepareTileID('ui_selections', 0);
	loader.prepareTileID('ui_selections', 1);
	loader.prepareTileID('ui_icon_equipment', 0);
	loader.prepareTileID('ui_quickslots', 1);
	loader.prepareTileID('ui_quickslots', 0);
	loader.prepareTileID('ui_selections', 2);
	loader.prepareTileID('ui_selections', 3);
	loader.prepareTileID('ui_selections', 4);
	for (let i = 0; i < 5; ++i) { loader.prepareTileID('ui_splatters1', i); loader.prepareTileID('ui_splatters1', i + 8); }
	loader.prepareTileID('ui_icon_immunity', 0);
	for (let i = 0; i < 10; ++i) loader.prepareTileID('map_dynamic_placeholders', i);
	world.visualEffectTypes.initialize(loader);
	world.skills.initialize();
	HeroCollection.prepareHeroesTileId(loader);

	// item categories
	for (const list of content.itemcategories) for (const o of list) {
		world.itemCategories.itemCategories.set(o.id, new ItemCategory(o.id, o.name,
			o.actionType || 'none', o.inventorySlot || null, o.size || 'none'));
	}
	// actor conditions
	for (const list of content.actorconditions) for (const o of list) {
		world.actorConditionsTypes.conditionTypes.set(o.id, new ActorConditionType(o.id, o.name, o.description || '',
			PU.parseImageID(loader, o.iconID), o.category, (o.isStacking | 0) > 0, (o.isPositive | 0) > 0,
			PU.parseStatsModifierTraits(o.roundEffect), PU.parseStatsModifierTraits(o.fullRoundEffect), PU.parseAbilityModifierTraits(o.abilityEffect)));
	}
	// items
	const itp = new ItemTraitsParser(world.actorConditionsTypes);
	for (const list of content.items) for (const o of list) {
		const t = new ItemType(o.id, PU.parseImageID(loader, o.iconID), o.name, o.description == null ? null : o.description,
			world.itemCategories.getItemCategory(o.category || 'other'), o.displaytype || 'ordinary',
			(o.hasManualPrice | 0) > 0, o.baseMarketCost | 0,
			itp.onEquip(o.equipEffect), itp.onUse(o.useEffect), itp.onUse(o.hitEffect), itp.onUse(o.missEffect), itp.onUse(o.killEffect),
			itp.onHitReceived(o.hitReceivedEffect), itp.onHitReceived(o.missReceivedEffect));
		world.itemTypes.itemTypes.set(o.id, t);
	}
	// item filters
	for (const list of content.itemfilters) for (const o of list) {
		world.itemFilters.itemFilters.set(o.id, new ItemFilter(o.id, (o.include || []).map((id) => world.itemTypes.getItemType(id)).filter(Boolean)));
	}
	// droplists
	for (const list of content.droplists) for (const o of list) {
		const items = (o.items || []).map((d) => new DropItem(d.itemID, PU.parseChance(d.chance), PU.parseQuantity(d.quantity)));
		world.dropLists.droplists.set(o.id, new DropList(items, world.itemTypes, world.itemFilters));
	}
	// quests
	let sortOrder = 0;
	for (const list of content.quests) for (const o of list) {
		const stages = (o.stages || []).map((s) => new QuestLogEntry(s.progress | 0, s.logText == null ? null : s.logText, s.rewardExperience | 0, (s.finishesQuest | 0) > 0));
		stages.sort((a, b) => a.progress - b.progress);
		++sortOrder;
		world.quests.quests.set(o.id, new Quest(o.id, o.name, stages, (o.showInLog | 0) > 0, sortOrder));
	}
	// conversations
	world.conversationLoader.init(content.conversations);
	// monsters
	for (const list of content.monsters) for (const o of list) {
		const maxHP = o.maxHP == null ? 1 : o.maxHP | 0, maxAP = o.maxAP == null ? 10 : o.maxAP | 0;
		const attackCost = o.attackCost == null ? 10 : o.attackCost | 0, attackChance = o.attackChance | 0;
		const dp = PU.parseConstRange(o.attackDamage);
		const cs = o.criticalSkill | 0, cm = o.criticalMultiplier == null ? 0 : Number(o.criticalMultiplier);
		const bc = o.blockChance | 0, dr = o.damageResistance | 0;
		const hit = itp.onUse(o.hitEffect), hitRecv = itp.onHitReceived(o.hitReceivedEffect), death = itp.onUse(o.deathEffect);
		const t = new MonsterType({
			id: o.id, name: o.name, spawnGroup: o.spawnGroup || o.id,
			exp: getExpectedMonsterExperience(attackCost, attackChance, dp, cs, cm, bc, dr, hit, maxHP, maxAP),
			dropList: world.dropLists.getDropList(o.droplistID || null), phraseID: o.phraseID || null,
			isUnique: (o.unique | 0) > 0, faction: o.faction || null,
			monsterClass: o.monsterClass || 'humanoid', aggressionType: o.movementAggressionType || 'none',
			tileSize: PU.parseTilesetTileSize(loader, o.iconID, new Size(1, 1)), iconID: PU.parseImageID(loader, o.iconID),
			horizontalFlipChance: o.horizontalFlipChance | 0, maxAP, maxHP, moveCost: o.moveCost == null ? 10 : o.moveCost | 0,
			attackCost, attackChance, criticalSkill: cs, criticalMultiplier: cm, damagePotential: dp, blockChance: bc,
			damageResistance: dr, onHitEffects: hit ? [hit] : null, onHitReceivedEffects: hitRecv ? [hitRecv] : null, onDeathEffects: death,
		});
		world.monsterTypes.monsterTypesById.set(o.id, t);
	}
	// maps (objects only; layers are loaded on demand)
	world.maps.addAll(content.maps.map((m) => transformMap(m, world)));
	loader.prepareAllMapTiles();
	loader.flush();
	// world map
	for (const s of content.worldmap) {
		const seg = new WorldMapSegment(s.id);
		seg.offset = new Coord(s.x, s.y);
		const inAreas = [];
		for (const [id, x, y, area] of s.maps) {
			if (!world.maps.findPredefinedMap(id)) continue;
			seg.maps.set(id, { mapName: id, worldPosition: new Coord(x, y) });
			if (area) inAreas.push([id, area]);
		}
		for (const [id, name, type] of s.areas) seg.namedAreas.set(id, { id, name, type, mapNames: new Set() });
		for (const [m, a] of inAreas) { const na = seg.namedAreas.get(a); if (na) na.mapNames.add(m); }
		world.maps.worldMapSegments.set(seg.name, seg);
	}
	world.mapLoader = new MapLoader(world, content.mapChunk);
}

const propVal = (props, name) => { for (const [n, v] of props) if (n.toLowerCase() === name.toLowerCase()) return v; return null; };
function objPosition(o) {
	return new CoordRect(new Coord(Math.round(o.x / 32), Math.round(o.y / 32)), new Size(Math.round(o.w / 32), Math.round(o.h / 32)));
}
function parseRequirementProps(o) {
	let type = 'questProgress', id = null, value = 0, negate = false, chance = null;
	for (const [n, v] of o.props) {
		const ln = n.toLowerCase();
		if (ln === 'requiretype') type = RequirementType.values.includes(v) ? v : null;
		else if (ln === 'requireid') id = v;
		else if (ln === 'requirevalue') value = parseInt(v, 10) | 0;
		else if (ln === 'requirenegation') negate = String(v).toLowerCase() === 'true';
	}
	if (type == null) return null;
	if (type === 'random') { chance = PU.parseChance(id); id = null; }
	return new Requirement(type, id, value, negate, chance);
}

function transformMap(m, world) {
	let isOutdoors = false, colorFilter = null;
	for (const [n, v] of m.props) {
		if (n.toLowerCase() === 'outdoors') isOutdoors = parseInt(v, 10) !== 0;
		else if (n.toLowerCase() === 'colorfilter') colorFilter = v;
	}
	const mapObjects = [], spawnAreas = [], activeGroups = [];
	for (const g of m.groups) {
		let active = true;
		for (const [n, v] of g.props) if (n.toLowerCase() === 'active') active = String(v).toLowerCase() === 'true';
		if (active) activeGroups.push(g.name);
		for (const o of g.objects) {
			const position = objPosition(o);
			const type = o.type == null ? null : o.type;
			if (type == null) continue;
			const lt = type.toLowerCase();
			if (lt === 'sign') mapObjects.push(MapObject.createMapSignEvent(position, o.name, g.name));
			else if (lt === 'mapchange') {
				mapObjects.push(MapObject.createMapChangeArea(position, o.name, propVal(o.props, 'map'), propVal(o.props, 'place'), g.name));
			} else if (lt === 'spawn') {
				let activeNew = true, ignoreAreas = false, maxQ = 1, respawn = 10, spawnGroup = o.name;
				for (const [n, v] of o.props) {
					const ln = n.toLowerCase();
					if (ln === 'quantity') maxQ = parseInt(v, 10);
					else if (ln === 'respawnspeed') respawn = parseInt(v, 10);
					else if (ln === 'active') activeNew = String(v).toLowerCase() === 'true';
					else if (ln === 'ignoreareas') ignoreAreas = String(v).toLowerCase() === 'true';
					else if (ln === 'spawngroup') spawnGroup = v;
				}
				const types = world.monsterTypes.getMonsterTypesFromSpawnGroup(spawnGroup || '');
				if (types.length === 0) continue;
				spawnAreas.push(new MonsterSpawnArea(position, new Range(maxQ, 0), new Range(1000, respawn), o.name,
					types.map((t) => t.id), types[0].isUnique, ignoreAreas, g.name, activeNew));
			} else if (lt === 'key') {
				const phraseID = propVal(o.props, 'phrase') || '';
				mapObjects.push(MapObject.createKeyArea(position, phraseID, parseRequirementProps(o), g.name));
			} else if (type === 'rest') mapObjects.push(MapObject.createRestArea(position, o.name, g.name));
			else if (type === 'container') {
				const dl = world.dropLists.getDropList(o.name);
				if (dl == null) continue;
				mapObjects.push(MapObject.createContainerArea(position, dl, g.name));
			} else if (lt === 'script') {
				let when = 'whenEntering';
				const w = propVal(o.props, 'when');
				if (w) {
					const lw = w.toLowerCase();
					if (lw === 'enter') when = 'whenEntering';
					else if (lw === 'step') when = 'onEveryStep';
					else if (lw === 'round') when = 'afterEveryRound';
					else if (lw === 'always') when = 'continuously';
				}
				mapObjects.push(MapObject.createScriptArea(position, o.name, when, g.name));
			}
		}
	}
	const pm = new PredefinedMap(m.name, m.name, new Size(m.w, m.h), mapObjects, spawnAreas, activeGroups, isOutdoors, colorFilter);
	pm.tmx = m; // keep raw object data for "replace" areas
	return pm;
}

// ------------------------------------------------------------- layer data (TMXMapTranslator.transformMap)
function b64ToBytes(b64) {
	const bin = atob(b64);
	const u = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; ++i) u[i] = bin.charCodeAt(i);
	return u;
}
async function inflate(bytes) {
	const ds = new DecompressionStream('deflate');
	const stream = new Blob([bytes]).stream().pipeThrough(ds);
	return new Uint8Array(await new Response(stream).arrayBuffer());
}
function hexToBytes(h) { const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; ++i) u[i] = parseInt(h.substr(i * 2, 2), 16); return u; }

export class MapLoader {
	constructor(world, mapChunk) {
		this.world = world;
		this.mapChunk = mapChunk;
		this.chunks = new Map();
		this.decoded = new Map(); // mapName -> {tilesets, layers:Map(lname -> {gids:Int32Array, md5:Uint8Array})}
		this.base = 'data/layers/';
	}
	_chunk(i) {
		if (!this.chunks.has(i)) {
			const p = fetch(this.base + String(i).padStart(2, '0') + '.json').then((r) => { if (!r.ok) throw new Error('chunk ' + i); return r.json(); });
			p.catch(() => this.chunks.delete(i));
			this.chunks.set(i, p);
		}
		return this.chunks.get(i);
	}
	prefetchAll() {
		const n = Math.max(...Object.values(this.mapChunk)) + 1;
		for (let i = 0; i < n; ++i) this._chunk(i);
	}
	async _decoded(name) {
		if (this.decoded.has(name)) return this.decoded.get(name);
		const chunk = await this._chunk(this.mapChunk[name]);
		const raw = chunk[name];
		const layers = new Map();
		for (const [lname, b64, md5] of raw.layers) {
			const bytes = await inflate(b64ToBytes(b64));
			const gids = new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
			layers.set(lname.toLowerCase(), { gids: new Int32Array(gids), md5: hexToBytes(md5) });
		}
		const d = { tilesets: raw.tilesets, layers };
		this.decoded.set(name, d);
		return d;
	}
	async loadLayeredTileMap(pmap) {
		const d = await this._decoded(pmap.name);
		return transformLayers(pmap, d, this.world.tileManager.tileCache);
	}
}

function transformLayers(pmap, d, tileCache) {
	const W = pmap.size.width, H = pmap.size.height;
	let colorFilter = 'none';
	const cf = propVal(pmap.tmx.props, 'colorfilter');
	if (cf) colorFilter = cf;
	const usedTileIDs = new Set();
	const tilesets = d.tilesets; // [[firstgid, name]] ascending
	const gidToTile = (gid) => {
		for (let i = tilesets.length - 1; i >= 0; --i) {
			if (tilesets[i][0] <= gid) return tileCache.getTileID(tilesets[i][1], gid - tilesets[i][0]);
		}
		return 0;
	};
	const find = (name) => (name ? d.layers.get(name.toLowerCase()) || null : null);
	const transformLayer = (name, area) => {
		const src = find(name);
		if (!src) return null;
		const out = new MapLayer(area.size);
		for (let dy = 0, sy = area.topLeft.y; dy < area.size.height; ++dy, ++sy) {
			for (let dx = 0, sx = area.topLeft.x; dx < area.size.width; ++dx, ++sx) {
				const gid = src.gids[sy * W + sx];
				if (gid <= 0) continue;
				const id = gidToTile(gid);
				out.setTile(id, dx, dy);
				usedTileIDs.add(id);
			}
		}
		return out;
	};
	const transformWalkable = (name, area) => {
		const src = find(name);
		if (!src) return null;
		const w = { w: area.size.width, h: area.size.height, data: new Uint8Array(area.size.width * area.size.height).fill(1) };
		for (let dy = 0, sy = area.topLeft.y; dy < area.size.height; ++dy, ++sy) {
			for (let dx = 0, sx = area.topLeft.x; dx < area.size.width; ++dx, ++sx) {
				if (src.gids[sy * W + sx] > 0) w.data[dx * w.h + dy] = 0;
			}
		}
		return w;
	};
	const layoutHash = (names) => {
		// XOR-combine the per-layer MD5s (the Android build MD5s them; only identity matters here)
		const h = new Uint8Array(16);
		let k = 1;
		for (const n of names) {
			const l = find(n);
			if (!l) continue;
			for (let i = 0; i < 16; ++i) h[i] = (h[i] * 31 + l.md5[i] * k) & 0xff;
			k += 2;
		}
		return h;
	};
	const section = (names, area) => new MapSection(
		transformLayer(names.base, area), transformLayer(names.ground, area), transformLayer(names.objects, area),
		transformLayer(names.above, area), transformLayer(names.top, area), transformWalkable(names.walkable, area),
		layoutHash([names.base, names.ground, names.objects, names.above, names.top]));
	const defaults = { base: 'base', ground: 'ground', objects: 'objects', above: 'above', top: 'top', walkable: 'walkable' };
	const layout = section(defaults, new CoordRect(new Coord(0, 0), new Size(W, H)));
	if (!layout.isWalkable) layout.isWalkable = { w: W, h: H, data: new Uint8Array(W * H).fill(1) };
	const replacements = [];
	for (const g of pmap.tmx.groups) {
		for (const o of g.objects) {
			if (o.type !== 'replace') continue;
			const position = objPosition(o);
			const names = { base: null, ground: null, objects: null, above: null, top: null, walkable: null };
			for (const [n, v] of o.props) { const ln = n.toLowerCase(); if (ln in names) names[ln] = v; }
			const sec = section(names, position);
			let req = parseRequirementProps(o);
			if (req == null || !req.isValid()) {
				const qp = QuestProgress.parseQuestProgress(o.name);
				if (qp != null) req = new Requirement(qp);
			}
			if (req == null || !req.isValid()) continue;
			replacements.push(new ReplaceableMapSection(position, sec, req, g.name));
		}
	}
	return new LayeredTileMap(pmap.size, layout, replacements.length ? replacements : null, colorFilter, usedTileIDs);
}
