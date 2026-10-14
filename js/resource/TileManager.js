// Port of resource/tiles/{TileManager, TileCache, DynamicTileLoader, ResourceFileTileset}
// Tile IDs are assigned in the same order as the Android build so the static icon constants match.
import { Size } from '../util.js';

const B = 1;
export const TileManager = {
	BEGIN_ID: B,
	CHAR_HERO_0: B, CHAR_HERO_1: B + 1, CHAR_HERO_2: B + 2, CHAR_HERO_SHIP: B + 3, CHAR_HERO_SHEEP: B + 4,
	CHAR_HERO: B, LAST_HERO: B + 2,
};
(() => {
	const T = TileManager;
	T.iconID_selection_red = T.CHAR_HERO_SHEEP + 1;
	T.iconID_selection_yellow = T.iconID_selection_red + 1;
	T.iconID_attackselect = T.iconID_selection_red;
	T.iconID_moveselect = T.iconID_selection_yellow;
	T.iconID_groundbag = T.iconID_moveselect + 1;
	T.iconID_boxopened = T.iconID_groundbag + 1;
	T.iconID_boxclosed = T.iconID_boxopened + 1;
	T.iconID_shop = T.iconID_groundbag;
	T.iconID_unassigned_quickslot = T.iconID_groundbag;
	T.iconID_selection_blue = T.iconID_boxclosed + 1;
	T.iconID_selection_purple = T.iconID_selection_blue + 1;
	T.iconID_selection_green = T.iconID_selection_purple + 1;
	T.iconID_splatter_red_1a = T.iconID_selection_green + 1;
	T.iconID_splatter_red_1b = T.iconID_splatter_red_1a + 1;
	T.iconID_splatter_red_2a = T.iconID_splatter_red_1b + 1;
	T.iconID_splatter_red_2b = T.iconID_splatter_red_2a + 1;
	T.iconID_splatter_brown_1a = T.iconID_splatter_red_2b + 1;
	T.iconID_splatter_brown_1b = T.iconID_splatter_brown_1a + 1;
	T.iconID_splatter_brown_2a = T.iconID_splatter_brown_1b + 1;
	T.iconID_splatter_brown_2b = T.iconID_splatter_brown_2a + 1;
	T.iconID_splatter_white_1a = T.iconID_splatter_brown_2b + 1;
	T.iconID_splatter_white_1b = T.iconID_splatter_white_1a + 1;
	T.iconID_immunity_overlay = T.iconID_splatter_white_1b + 1;
	T.tileID_placeholder_hero = T.iconID_immunity_overlay + 1;
	T.tileID_placeholder_hat = T.tileID_placeholder_hero + 1;
	T.tileID_placeholder_armor = T.tileID_placeholder_hat + 1;
	T.tileID_placeholder_necklace = T.tileID_placeholder_armor + 1;
	T.tileID_placeholder_weapon = T.tileID_placeholder_necklace + 1;
	T.tileID_placeholder_shield = T.tileID_placeholder_weapon + 1;
	T.tileID_placeholder_lring = T.tileID_placeholder_shield + 1;
	T.tileID_placeholder_rring = T.tileID_placeholder_lring + 1;
	T.tileID_placeholder_gloves = T.tileID_placeholder_rring + 1;
	T.tileID_placeholder_boots = T.tileID_placeholder_gloves + 1;
})();

export class ResourceFileTileset {
	constructor(tilesetName, gridDimensions, spriteDimensionsInTiles, tileSize) {
		this.tilesetName = tilesetName;
		this.numTiles = gridDimensions;
		this.spriteDimensionsInTiles = spriteDimensionsInTiles;
		this.destinationTileSize = new Size(tileSize * spriteDimensionsInTiles.width, tileSize * spriteDimensionsInTiles.height);
	}
}

// Global tile registry: tileID -> {tileset, localID}
export class TileCache {
	constructor() {
		this.resourceTiles = [null];
		this.byTileset = new Map(); // name -> Map(localID -> tileID)
	}
	getMaxTileID() { return this.resourceTiles.length - 1; }
	allocateMaxTileID(max) { while (this.resourceTiles.length <= max) this.resourceTiles.push(null); }
	setTile(tileID, tileset, localID) {
		if (this.resourceTiles[tileID] == null) this.resourceTiles[tileID] = { tileset, localID };
		let m = this.byTileset.get(tileset.tilesetName);
		if (!m) { m = new Map(); this.byTileset.set(tileset.tilesetName, m); }
		m.set(localID, tileID);
	}
	getTileID(tilesetName, localID) {
		const m = this.byTileset.get(tilesetName);
		if (!m) return 0;
		return m.get(localID) || 0;
	}
	getTile(tileID) { return this.resourceTiles[tileID] || null; }
}

export class DynamicTileLoader {
	constructor(tileCache) {
		this.tileCache = tileCache;
		this.byName = new Map(); // name -> {tileset, ids: Map(localID -> tileID)}
		this.currentTileStoreIndex = tileCache.getMaxTileID();
	}
	prepareTileset(name, grid, spriteDims, tileSize) {
		this.byName.set(name, { tileset: new ResourceFileTileset(name, grid, spriteDims, tileSize), ids: new Map() });
	}
	prepareTileID(name, localID) {
		const b = this.byName.get(name);
		if (!b) { console.warn('Cannot load tileset ' + name); return 0; }
		let id = b.ids.get(localID);
		if (!id) { id = ++this.currentTileStoreIndex; b.ids.set(localID, id); }
		return id;
	}
	getTilesetTileSize(name) {
		const b = this.byName.get(name);
		return b ? b.tileset.spriteDimensionsInTiles : new Size(1, 1);
	}
	prepareAllMapTiles() {
		for (const [name, b] of this.byName) {
			if (!name.startsWith('map_')) continue;
			const n = b.tileset.numTiles.width * b.tileset.numTiles.height;
			for (let i = 0; i < n; ++i) this.prepareTileID(name, i);
		}
	}
	flush() {
		this.tileCache.allocateMaxTileID(this.currentTileStoreIndex);
		for (const b of this.byName.values()) {
			for (const [localID, tileID] of b.ids) this.tileCache.setTile(tileID, b.tileset, localID);
		}
	}
}

// Image-backed tile renderer for the browser.
export class TileRenderer {
	constructor(tileCache, imageBase) {
		this.tileCache = tileCache;
		this.imageBase = imageBase;
		this.images = new Map(); // tileset name -> HTMLImageElement
		this.loading = new Map();
		this.flipCache = new Map();
		this.onImageLoaded = null;
		this.tileSize = 32;
	}
	loadTileset(name) {
		if (this.images.has(name)) return Promise.resolve(this.images.get(name));
		if (this.loading.has(name)) return this.loading.get(name);
		const p = new Promise((resolve) => {
			const img = new Image();
			img.onload = () => { this.images.set(name, img); this.loading.delete(name); if (this.onImageLoaded) this.onImageLoaded(name); resolve(img); };
			img.onerror = () => { console.warn('img fail', name); this.loading.delete(name); resolve(null); };
			img.src = this.imageBase + name + '.png';
		});
		this.loading.set(name, p);
		return p;
	}
	async ensureTilesFor(tileIDs) {
		const names = new Set();
		for (const id of tileIDs) { const t = this.tileCache.getTile(id); if (t) names.add(t.tileset.tilesetName); }
		await Promise.all([...names].map((n) => this.loadTileset(n)));
	}
	// Returns {img, sx, sy, sw, sh, dw, dh} or null if not loaded
	getSource(tileID) {
		const t = this.tileCache.getTile(tileID);
		if (!t) return null;
		const ts = t.tileset;
		const img = this.images.get(ts.tilesetName);
		if (!img) { this.loadTileset(ts.tilesetName); return null; }
		const sw = Math.floor(img.naturalWidth / ts.numTiles.width);
		const sh = Math.floor(img.naturalHeight / ts.numTiles.height);
		const x = t.localID % ts.numTiles.width;
		const y = (t.localID - x) / ts.numTiles.width;
		return { img, sx: x * sw, sy: y * sh, sw, sh, wTiles: ts.spriteDimensionsInTiles.width, hTiles: ts.spriteDimensionsInTiles.height };
	}
	drawTile(ctx, tileID, px, py, size, flipX = false) {
		const s = this.getSource(tileID);
		if (!s) return false;
		const dw = size * s.wTiles, dh = size * s.hTiles;
		if (flipX) {
			ctx.save();
			ctx.translate(px + dw, py);
			ctx.scale(-1, 1);
			ctx.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, 0, 0, dw, dh);
			ctx.restore();
		} else {
			ctx.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, px, py, dw, dh);
		}
		return true;
	}
	// Small canvas element with the icon (for HTML UI)
	makeIcon(tileID, size = 32, overlayID = -1) {
		const c = document.createElement('canvas');
		const dpr = Math.min(3, window.devicePixelRatio || 1);
		c.width = size * dpr; c.height = size * dpr;
		c.style.width = size + 'px'; c.style.height = size + 'px';
		c.className = 'tileicon';
		const ctx = c.getContext('2d');
		ctx.imageSmoothingEnabled = false;
		const draw = () => {
			ctx.clearRect(0, 0, c.width, c.height);
			if (overlayID > 0) this._drawFit(ctx, overlayID, c.width);
			this._drawFit(ctx, tileID, c.width);
		};
		const s = this.getSource(tileID);
		const o = overlayID > 0 ? this.getSource(overlayID) : true;
		if (s && o) draw();
		else {
			const t = this.tileCache.getTile(tileID);
			const ps = [];
			if (t) ps.push(this.loadTileset(t.tileset.tilesetName));
			const ot = overlayID > 0 ? this.tileCache.getTile(overlayID) : null;
			if (ot) ps.push(this.loadTileset(ot.tileset.tilesetName));
			Promise.all(ps).then(draw);
		}
		return c;
	}
	_drawFit(ctx, tileID, size) {
		const s = this.getSource(tileID);
		if (!s) return;
		const scale = size / Math.max(s.wTiles, s.hTiles);
		const dw = s.wTiles * scale, dh = s.hTiles * scale;
		ctx.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, (size - dw) / 2, (size - dh) / 2, dw, dh);
	}
}
