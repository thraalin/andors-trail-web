// Port of context/WorldContext, context/ControllerContext, AndorsTrailPreferences, WorldSetup, Savegames
import {
	ItemTypeCollection, ItemFilterCollection, ItemCategoryCollection, MonsterTypeCollection, DropListCollection,
	QuestCollection, ActorConditionTypeCollection, SkillCollection, MapCollection, ModelContainer, Player,
	GameStatistics, WorldData, InterfaceData,
} from './model.js';
import { Coord } from './util.js';
import { TileCache, TileRenderer } from './resource/TileManager.js';
import { ConversationLoader, VisualEffectCollection } from './resource/ResourceLoader.js';
import { MapController } from './controller/MapController.js';
import { CombatController } from './controller/CombatController.js';
import { GameRoundController } from './controller/GameRoundController.js';
import { ConversationController } from './controller/ConversationController.js';
import { VisualEffectController } from './controller/VisualEffectController.js';
import { ItemController } from './controller/ItemController.js';
import { MonsterMovementController, MonsterSpawningController } from './controller/MonsterMovementController.js';
import { MovementController } from './controller/MovementController.js';
import { ActorStatsController } from './controller/ActorStatsController.js';
import { InputController } from './controller/InputController.js';
import { SkillController } from './controller/SkillController.js';

export class WorldContext {
	constructor() {
		this.conversationLoader = new ConversationLoader();
		this.itemTypes = new ItemTypeCollection();
		this.itemFilters = new ItemFilterCollection();
		this.itemCategories = new ItemCategoryCollection();
		this.monsterTypes = new MonsterTypeCollection();
		this.visualEffectTypes = new VisualEffectCollection();
		this.dropLists = new DropListCollection();
		this.tileManager = { tileCache: new TileCache(), tileSize: 32 };
		this.maps = new MapCollection();
		this.quests = new QuestCollection();
		this.actorConditionsTypes = new ActorConditionTypeCollection();
		this.skills = new SkillCollection();
		this.model = null;
		this.mapLoader = null;
	}
	resetForNewGame() { this.maps.resetForNewGame(); }
}

const PREFS_KEY = 'andorstrail.prefs';
export class Preferences {
	constructor() {
		this.confirmRest = true;
		this.confirmAttack = true;
		this.displayLoot = 'dialog_always'; // dialog_always | dialog_for_items | dialog_for_items_else_toast | toast | toast_for_items | none
		this.attackspeed_milliseconds = 1000;
		this.movementMethod = 'directional'; // straight | directional
		this.movementAggressiveness = 'normal';
		this.enableUiAnimations = true;
		this.scalingFactor = 1.0;
		this.dpadPosition = 'disabled'; // disabled | lower_right | lower_left | lower_center
		this.quickslotsVisible = true;
		this.highQualityFilters = true;
	}
	read() {
		try {
			const s = localStorage.getItem(PREFS_KEY);
			if (s) Object.assign(this, JSON.parse(s));
		} catch (e) { /* storage unavailable */ }
		return this;
	}
	write() {
		try { localStorage.setItem(PREFS_KEY, JSON.stringify(this)); } catch (e) { /* ignore */ }
	}
}

export class ControllerContext {
	constructor(world, preferences) {
		this.preferences = preferences;
		this.mapController = new MapController(this, world);
		this.combatController = new CombatController(this, world);
		this.gameRoundController = new GameRoundController(this, world);
		this.conversationController = new ConversationController(this, world);
		this.effectController = new VisualEffectController(this, world);
		this.itemController = new ItemController(this, world);
		this.monsterMovementController = new MonsterMovementController(this, world);
		this.monsterSpawnController = new MonsterSpawningController(this, world);
		this.movementController = new MovementController(this, world);
		this.actorStatsController = new ActorStatsController(this, world);
		this.inputController = new InputController(this, world);
		this.skillController = new SkillController(this, world);
	}
}

// --------------------------------------------------------------- WorldSetup
export async function createNewWorld(world, controllers, name, iconID, startLives = -1, unlimitedSaves = true) {
	world.resetForNewGame();
	world.model = new ModelContainer(startLives, unlimitedSaves);
	world.model.player.initializeNewPlayer(world.dropLists, name, iconID);
	controllers.gameRoundController.updateTimerState();
	controllers.mapController.lotsOfTimePassed();
	await controllers.movementController.respawnPlayer();
}

// --------------------------------------------------------------- Savegames (JSON in localStorage)
export const SAVE_VERSION = 1;
const SAVE_PREFIX = 'andorstrail.save.';

export const Savegames = {
	SLOT_QUICKSAVE: 0,
	key(slot) { return SAVE_PREFIX + slot; },
	serialize(world) {
		const m = world.model;
		return {
			v: SAVE_VERSION,
			header: { name: m.player.getName(), level: m.player.getLevel(), xp: m.player.getTotalExperience(), gold: m.player.getGold(),
				iconID: m.player.baseTraits.iconID, time: Date.now(), map: m.currentMaps.map.name },
			maps: world.maps.toJSON(world),
			player: m.player.toJSON(),
			currentMap: m.currentMaps.map.name,
			stats: m.statistics.toJSON(),
			worldData: m.worldData.toJSON(),
		};
	},
	saveWorld(world, slot) {
		try {
			const data = Savegames.serialize(world);
			localStorage.setItem(Savegames.key(slot), JSON.stringify(data));
			return true;
		} catch (e) {
			console.error('save failed', e);
			return false;
		}
	},
	getHeader(slot) {
		try {
			const s = localStorage.getItem(Savegames.key(slot));
			if (!s) return null;
			return JSON.parse(s).header;
		} catch (e) { return null; }
	},
	listSlots() {
		const out = [];
		try {
			for (let i = 0; i < localStorage.length; ++i) {
				const k = localStorage.key(i);
				if (k && k.startsWith(SAVE_PREFIX)) {
					const slot = parseInt(k.substring(SAVE_PREFIX.length), 10);
					const h = Savegames.getHeader(slot);
					if (h) out.push({ slot, header: h });
				}
			}
		} catch (e) { /* ignore */ }
		return out.sort((a, b) => a.slot - b.slot);
	},
	deleteSlot(slot) { try { localStorage.removeItem(Savegames.key(slot)); } catch (e) { /* */ } },
	exportSlot(slot) { try { return localStorage.getItem(Savegames.key(slot)); } catch (e) { return null; } },
	importToSlot(slot, text) {
		const data = JSON.parse(text);
		if (!data || !data.header || !data.player) throw new Error('Not an Andor\'s Trail web save');
		localStorage.setItem(Savegames.key(slot), JSON.stringify(data));
	},
	async loadWorld(world, controllers, slot) {
		const s = localStorage.getItem(Savegames.key(slot));
		if (!s) return 'missing';
		const data = JSON.parse(s);
		return Savegames.loadFromData(world, controllers, data);
	},
	async loadFromData(world, controllers, data) {
		controllers.movementController.stopMovement();
		world.resetForNewGame();
		const model = new ModelContainer();
		world.model = model;
		model.player = Player.fromJSON(data.player, world);
		model.statistics = GameStatistics.fromJSON(data.stats, world);
		model.worldData = WorldData.fromJSON(data.worldData);
		model.uiSelections = new InterfaceData();
		controllers.gameRoundController.updateTimerState();
		world.maps.readJSON(data.maps, world, controllers);
		const map = world.maps.findPredefinedMap(data.currentMap);
		model.currentMaps.map = map;
		// onWorldLoaded
		controllers.actorStatsController.recalculatePlayerStats(model.player);
		controllers.mapController.resetMapsNotRecentlyVisited();
		const tiles = await world.mapLoader.loadLayeredTileMap(map);
		controllers.movementController.prepareMapAsCurrentMap(map, false, tiles);
		controllers.gameRoundController.resetRoundTimers();
		return 'success';
	},
};
