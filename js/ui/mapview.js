// Canvas port of view/MainView.java: layered tile map, actors, bags, splatters, selection, combat effects.
import { Coord } from '../util.js';
import { TileManager } from '../resource/TileManager.js';

const T = 32; // source tile size

export class MapView {
	constructor(canvas, world, controllers, renderer) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d');
		this.world = world;
		this.controllers = controllers;
		this.r = renderer;
		this.dpr = 1;
		this.tileCss = 32;
		this.bgCanvas = null;   // base+ground+objects
		this.fgCanvas = null;   // above+top
		this.dirty = true;
		this.map = null;
		this.tileMap = null;
		this.cam = { x: 0, y: 0 };
		this.camInit = false;
		this.effects = [];
		this.running = false;
		this.onTapTile = null;   // set by app
		this.resize();
		window.addEventListener('resize', () => this.resize());
		renderer.onImageLoaded = () => { this.dirty = true; };
		const C = controllers;
		C.effectController.visualEffectFrameListeners.add({
			onNewAnimationFrames: (list) => { this.effects = list; },
			onAnimationCompleted: (a) => { this.effects = this.effects.filter((e) => e !== a); },
		});
		C.mapController.mapLayoutListeners.add({ onMapTilesChanged: () => { this.dirty = true; } });
		C.movementController.playerMovementListeners.add({ onPlayerEnteredNewMap: () => this.setMap() });
		this.installInput();
	}
	resize() {
		const dpr = Math.min(3, window.devicePixelRatio || 1);
		this.dpr = dpr;
		const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
		this.canvas.width = Math.round(w * dpr);
		this.canvas.height = Math.round(h * dpr);
		this.tileCss = Math.round(32 * (this.controllers.preferences.scalingFactor || 1));
	}
	setMap() {
		const cm = this.world.model.currentMaps;
		this.map = cm.map;
		this.tileMap = cm.tileMap;
		this.dirty = true;
		this.camInit = false;
		this.effects = [];
		const ids = new Set(this.tileMap.usedTileIDs);
		for (const a of this.map.spawnAreas) {
			for (const id of a.monsterTypeIDs) { const t = this.world.monsterTypes.getMonsterType(id); if (t) ids.add(t.iconID); }
			for (const m of a.monsters) ids.add(m.iconID);
		}
		this.r.ensureTilesFor(ids).then(() => { this.dirty = true; });
	}
	start() {
		if (this.running) return;
		this.running = true;
		const loop = () => {
			if (!this.running) return;
			try { this.draw(); } catch (e) { console.error(e); }
			requestAnimationFrame(loop);
		};
		requestAnimationFrame(loop);
	}
	stop() { this.running = false; }

	buildLayers() {
		const tm = this.tileMap, map = this.map;
		const W = map.size.width, H = map.size.height;
		const mk = () => { const c = document.createElement('canvas'); c.width = W * T; c.height = H * T; return c; };
		if (!this.bgCanvas || this.bgCanvas.width !== W * T || this.bgCanvas.height !== H * T) { this.bgCanvas = mk(); this.fgCanvas = mk(); }
		const bg = this.bgCanvas.getContext('2d'), fg = this.fgCanvas.getContext('2d');
		bg.imageSmoothingEnabled = false; fg.imageSmoothingEnabled = false;
		bg.fillStyle = '#000'; bg.fillRect(0, 0, W * T, H * T);
		fg.clearRect(0, 0, W * T, H * T);
		const L = tm.currentLayout;
		const hero = this.world.model.player;
		const drawLayer = (ctx, layer) => {
			if (!layer) return;
			for (let x = 0; x < W; ++x) for (let y = 0; y < H; ++y) {
				let id = layer.get(x, y);
				if (!id) continue;
				if (id === TileManager.tileID_placeholder_hero) id = hero.iconID;
				this.r.drawTile(ctx, id, x * T, y * T, T);
			}
		};
		drawLayer(bg, L.layerBase); drawLayer(bg, L.layerGround); drawLayer(bg, L.layerObjects);
		drawLayer(fg, L.layerAbove); drawLayer(fg, L.layerTop);
		this.applyColorFilter(bg); this.applyColorFilter(fg, true);
	}
	applyColorFilter(ctx, keepAlpha) {
		const f = this.tileMap.colorFilter;
		if (!f || f === 'none') return;
		const c = ctx.canvas;
		if (f === 'invert' || f === 'bw') {
			const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
			for (let i = 0; i < d.length; i += 4) {
				if (f === 'invert') { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
				else { const g = 0.33 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = g; }
			}
			ctx.putImageData(img, 0, 0);
		}
	}
	// Overlay tint applied to the whole frame (matches the Android "alternate filter" paint)
	overlayColor() { return this.tileMap ? this.tileMap.getOverlayColor() : null; }

	actorPixel(a, now) {
		// interpolated position in map pixels (source scale)
		if (a.hasVFXRunning && a.vfxDuration > 0 && a.vfxOrigin) {
			const t = Math.min(1, (now - a.vfxStartTime) / a.vfxDuration);
			return { x: (a.vfxOrigin.x + (a.position.x - a.vfxOrigin.x) * t) * T, y: (a.vfxOrigin.y + (a.position.y - a.vfxOrigin.y) * t) * T };
		}
		return { x: a.position.x * T, y: a.position.y * T };
	}
	draw() {
		const ctx = this.ctx, cv = this.canvas;
		if (!this.map || !this.tileMap) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height); return; }
		if (this.world.model.currentMaps.map !== this.map) this.setMap();
		if (this.dirty) { this.dirty = false; this.buildLayers(); }
		const now = Date.now();
		const scale = (this.tileCss * this.dpr) / T; // device px per source px
		const viewW = cv.width / scale, viewH = cv.height / scale; // in source px
		const mapW = this.map.size.width * T, mapH = this.map.size.height * T;
		const p = this.world.model.player;
		const pp = this.actorPixel(p, now);
		// camera: centre the hero in the part of the screen not covered by the HUD bars, and let the map
		// scroll far enough that its edges line up with the bars instead of hiding under them.
		const hudT = document.getElementById('hudTop'), hudB = document.getElementById('hudBottom');
		const toSrc = this.dpr / scale;
		let padT = (hudT && !hudT.hidden ? hudT.offsetHeight : 0) * toSrc;
		let padB = (hudB && !hudB.hidden ? hudB.offsetHeight : 0) * toSrc;
		if (viewH - padT - padB < 3 * T) padB = Math.max(0, viewH - padT - 3 * T);
		const visH = viewH - padT - padB;
		let tx = mapW <= viewW ? (mapW - viewW) / 2 : Math.max(0, Math.min(mapW - viewW, pp.x + T / 2 - viewW / 2));
		let ty = mapH <= visH ? (mapH - visH) / 2 - padT : Math.max(-padT, Math.min(mapH - viewH + padB, pp.y + T / 2 - padT - visH / 2));
		if (!this.camInit) { this.cam.x = tx; this.cam.y = ty; this.camInit = true; }
		else { this.cam.x += (tx - this.cam.x) * 0.35; this.cam.y += (ty - this.cam.y) * 0.35; if (Math.abs(tx - this.cam.x) < 0.5) this.cam.x = tx; if (Math.abs(ty - this.cam.y) < 0.5) this.cam.y = ty; }
		const ox = -Math.round(this.cam.x * scale) / scale, oy = -Math.round(this.cam.y * scale) / scale;
		this.view = { scale, ox, oy };
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.imageSmoothingEnabled = false;
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, cv.width, cv.height);
		ctx.setTransform(scale, 0, 0, scale, ox * scale, oy * scale);
		ctx.drawImage(this.bgCanvas, 0, 0);
		const map = this.map;
		for (const s of map.splatters) this.r.drawTile(ctx, s.iconID, s.position.x * T, s.position.y * T, T);
		for (const l of map.groundBags) if (l.isVisible) this.r.drawTile(ctx, TileManager.iconID_groundbag, l.position.x * T, l.position.y * T, T);
		this.r.drawTile(ctx, p.mapIconID || p.iconID, pp.x, pp.y, T);
		for (const a of map.spawnAreas) for (const m of a.monsters) {
			const mp = this.actorPixel(m, now);
			this.r.drawTile(ctx, m.iconID, mp.x, mp.y, T, m.isFlippedX);
		}
		ctx.drawImage(this.fgCanvas, 0, 0);
		const ui = this.world.model.uiSelections;
		if (ui.selectedPosition) {
			this.r.drawTile(ctx, ui.selectedMonster ? TileManager.iconID_attackselect : TileManager.iconID_moveselect, ui.selectedPosition.x * T, ui.selectedPosition.y * T, T);
		}
		if (this.tapMarker && now - this.tapMarker.t < 400) {
			ctx.globalAlpha = 1 - (now - this.tapMarker.t) / 400;
			this.r.drawTile(ctx, TileManager.iconID_moveselect, this.tapMarker.x * T, this.tapMarker.y * T, T);
			ctx.globalAlpha = 1;
		}
		// combat effects
		for (const e of this.effects) {
			this.r.drawTile(ctx, e.tileID, e.position.x * T, e.position.y * T, T);
			if (e.displayText) {
				ctx.save();
				ctx.globalAlpha = Math.max(0, Math.min(1, e.textAlpha));
				ctx.font = 'bold 15px "Alegreya Sans", sans-serif';
				ctx.textAlign = 'center';
				ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)';
				const x = e.position.x * T + T / 2, y = e.position.y * T + T / 2 + e.textYOffset;
				ctx.strokeText(e.displayText, x, y);
				ctx.fillStyle = e.textColor;
				ctx.fillText(e.displayText, x, y);
				ctx.restore();
			}
		}
		const ov = this.overlayColor();
		if (ov) { ctx.fillStyle = ov; ctx.fillRect(0, 0, mapW, mapH); }
	}
	screenToTile(clientX, clientY) {
		const rect = this.canvas.getBoundingClientRect();
		const v = this.view;
		if (!v) return null;
		const sx = (clientX - rect.left) * this.dpr / v.scale - v.ox;
		const sy = (clientY - rect.top) * this.dpr / v.scale - v.oy;
		return new Coord(Math.floor(sx / T), Math.floor(sy / T));
	}
	installInput() {
		const cv = this.canvas;
		let down = null, holdTimer = null;
		const ic = this.controllers.inputController;
		cv.addEventListener('pointerdown', (e) => {
			if (!this.world.model || !this.world.model.uiSelections.isMainActivityVisible) return;
			cv.setPointerCapture(e.pointerId);
			const t = this.screenToTile(e.clientX, e.clientY);
			if (!t) return;
			down = { t, x: e.clientX, y: e.clientY, time: Date.now(), moved: false, holding: false, long: false };
			if (this.world.model.uiSelections.isInCombat) {
				holdTimer = setTimeout(() => { if (down) { down.long = true; this.onLongPress(t); } }, 450);
				return;
			}
			// hold-to-walk begins after a short delay so that a quick tap can mean "walk to"
			holdTimer = setTimeout(() => {
				if (!down) return;
				down.holding = true;
				ic.onTouchedTile(down.t.x, down.t.y);
			}, 180);
		});
		cv.addEventListener('pointermove', (e) => {
			if (!down) return;
			if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) down.moved = true;
			if (down.holding) {
				const t = this.screenToTile(e.clientX, e.clientY);
				if (t && !t.equals(down.t)) { down.t = t; ic.onTouchedTile(t.x, t.y); }
			}
		});
		const end = (e) => {
			clearTimeout(holdTimer);
			if (!down) return;
			const d = down; down = null;
			if (this.world.model.uiSelections.isInCombat) {
				if (!d.long && !d.moved) this.onCombatTap(d.t);
				return;
			}
			if (d.holding) { ic.onTouchCancel(); return; }
			if (!d.moved && this.onTapTile) this.onTapTile(d.t);
		};
		cv.addEventListener('pointerup', end);
		cv.addEventListener('pointercancel', () => { clearTimeout(holdTimer); if (down && down.holding) ic.onTouchCancel(); down = null; });
		cv.addEventListener('contextmenu', (e) => e.preventDefault());
	}
	onLongPress(t) {
		const ic = this.controllers.inputController;
		ic.lastTouchPosition_tileCoords.set(t.x, t.y);
		ic.lastTouchPosition_dx = t.x - this.world.model.player.position.x;
		ic.lastTouchPosition_dy = t.y - this.world.model.player.position.y;
		ic.onLongClick();
	}
	// Combat: tapping an adjacent tile selects it (like a long-press on Android); tapping the selection again acts on it.
	onCombatTap(t) {
		const ui = this.world.model.uiSelections;
		const p = this.world.model.player.position;
		const dx = t.x - p.x, dy = t.y - p.y;
		const ic = this.controllers.inputController;
		if (ui.selectedPosition && ui.selectedPosition.equals(t)) { ic.onRelativeMovement(dx, dy); return; }
		const m = this.world.model.currentMaps.map.getMonsterAt(t);
		if (m && m.isAgressive(this.world.model.player) && m.rectPosition.isAdjacentTo(p)) { this.controllers.combatController.setCombatSelection(m, t); return; }
		if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx || dy)) {
			if (ui.selectedMonster == null && !ui.selectedPosition) { ic.onRelativeMovement(dx, dy); return; } // fleeing direction
			this.onLongPress(t);
		}
	}
}
