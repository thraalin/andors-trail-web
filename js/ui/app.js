// Web front-end for the ported Andor's Trail engine (replaces MainActivity, StatusView, CombatView, QuickitemView, ToolboxView, StartScreen).
import { WorldContext, ControllerContext, Preferences, createNewWorld, Savegames } from '../context.js';
import { loadAllResources } from '../resource/ResourceLoader.js';
import { TileManager, TileRenderer } from '../resource/TileManager.js';
import { initStrings, getString as S } from '../strings.js';
import { Constants, Format } from '../util.js';
import { Loot, ActorCondition } from '../model.js';
import { PauseReason } from '../controller/GameRoundController.js';
import { MapView } from './mapview.js';
import { esc } from './describe.js';
import * as Screens from './screens.js';

const $ = (id) => document.getElementById(id);

class UI {
	constructor() {
		this.sheets = [];
		this.statusTimer = null;
		this.toastTimer = null;
		this.deferredQuicksave = false;
	}

	// ------------------------------------------------------------------ boot
	async boot() {
		const setProgress = (f, msg) => { $('loadbar').style.width = Math.round(f * 100) + '%'; if (msg) $('loadmsg').textContent = msg; };
		setProgress(0.05, 'Loading the world…');
		let content;
		try {
			const res = await fetch('data/content.json');
			if (!res.ok) throw new Error('HTTP ' + res.status);
			const total = Number(res.headers.get('content-length')) || 0;
			if (res.body && total) {
				const reader = res.body.getReader();
				const parts = []; let got = 0;
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					parts.push(value); got += value.length;
					setProgress(0.05 + 0.6 * (got / total));
				}
				content = JSON.parse(new TextDecoder().decode(await new Blob(parts).arrayBuffer()));
			} else {
				content = await res.json();
			}
		} catch (e) {
			setProgress(0, 'Could not load the game data. Check your connection and reload the page.');
			console.error(e);
			return;
		}
		setProgress(0.7, 'Preparing maps, monsters and quests…');
		await new Promise((r) => setTimeout(r, 30));
		initStrings(content.strings, content.plurals, content.arrays);
		this.world = new WorldContext();
		loadAllResources(this.world, content);
		this.prefs = new Preferences().read();
		this.controllers = new ControllerContext(this.world, this.prefs);
		this.renderer = new TileRenderer(this.world.tileManager.tileCache, 'data/img/');
		this.world.mapLoader.prefetchAll();
		// Preload UI tilesets
		await Promise.all(['char_hero', 'char_hero_maksiu_girl_01', 'char_hero_maksiu_boy_01', 'ui_selections', 'ui_icon_equipment', 'ui_quickslots',
			'ui_splatters1', 'ui_icon_immunity', 'effect_blood4', 'effect_heal2', 'effect_poison1', 'effect_miss1'].map((n) => this.renderer.loadTileset(n)));
		setProgress(1, 'Ready');
		this.mapView = new MapView($('map'), this.world, this.controllers, this.renderer);
		this.mapView.onTapTile = (t) => this.onTapTile(t);
		this.subscribe();
		this.installHUD();
		this.installLifecycle();
		this.controllers.inputController.ui = {
			openHeroInfo: () => Screens.showHeroInfo(this, 'overview'),
			toggleToolbox: () => Screens.showMenu(this),
			back: () => { if (this.sheets.length) this.sheets[this.sheets.length - 1].close(); },
		};
		this.showStart();
	}

	// ------------------------------------------------------------------ start screen
	showStart() {
		$('loading').hidden = true;
		$('game').hidden = true;
		$('start').hidden = false;
		this.mapView && this.mapView.stop();
		const menu = $('startMenu');
		menu.innerHTML = '';
		const header = Savegames.getHeader(0);
		const add = (label, cls, fn, sub) => {
			const b = document.createElement('button');
			b.className = 'btn ' + (cls || '');
			b.innerHTML = esc(label) + (sub ? `<br><small style="font-weight:500;opacity:.8">${esc(sub)}</small>` : '');
			b.onclick = fn;
			menu.appendChild(b);
			return b;
		};
		if (header) add(S('startscreen_continue'), 'primary', () => this.continueGame(), `${header.name}, ${S('savegame_currenthero_displayinfo', header.level, header.xp, header.gold)}`);
		add(S('startscreen_newgame'), header ? '' : 'primary', () => Screens.showNewGame(this, !!header));
		if (Savegames.listSlots().some((s) => s.slot > 0)) add(S('startscreen_load_game'), '', () => Screens.showSaveLoad(this, 'load'));
		add(S('menu_settings'), '', () => Screens.showSettings(this));
		add(S('startscreen_about'), '', () => Screens.showAbout(this));
	}
	async startNewGame(name, iconID, startLives, unlimitedSaves) {
		this.enterGameScreen();
		await createNewWorld(this.world, this.controllers, name, iconID, startLives, unlimitedSaves);
		this.onSceneLoaded();
		Savegames.saveWorld(this.world, 0);
	}
	async continueGame() { return this.loadSlot(0); }
	async loadSlot(slot) {
		this.enterGameScreen();
		try {
			const r = await Savegames.loadWorld(this.world, this.controllers, slot);
			if (r !== 'success') throw new Error(r);
			if (slot !== 0 && !this.world.model.statistics.hasUnlimitedSaves()) {
				Savegames.saveWorld(this.world, 0);
				Savegames.deleteSlot(slot);
			}
		} catch (e) {
			console.error(e);
			this.showStart();
			Screens.showMessage(this, S('dialog_loading_failed_title'), S('dialog_loading_failed_message'));
			return;
		}
		this.onSceneLoaded();
	}
	enterGameScreen() {
		$('start').hidden = true;
		$('loading').hidden = true;
		$('game').hidden = false;
		this.mapView.resize();
	}
	onSceneLoaded() {
		const w = this.world;
		this.mapView.setMap();
		this.mapView.start();
		this.controllers.gameRoundController.onMainActivityResumed();
		this.updateAll();
		this.refreshConditions();
		this.clearMessages();
		this.controllers.combatController.resumeCombatIfNeeded();
		this.updateCombatBar();
	}
	exitToTitle(save = true) {
		while (this.sheets.length) this.sheets[this.sheets.length - 1].close(true);
		if (save && this.world.model && !this.world.model.statistics.isDead()) this.quicksave();
		this.controllers.gameRoundController.onMainActivityPaused();
		this.controllers.movementController.stopMovement();
		if (this.world.model) this.world.model.uiSelections.isInCombat = false;
		$('combat').hidden = true; $('tools').hidden = false;
		this.showStart();
	}
	quicksave() {
		const w = this.world;
		if (!w.model || !w.model.currentMaps.map) return false;
		if (this.controllers.movementController.isMapTransitionInProgress()) { this.deferredQuicksave = true; return false; }
		this.deferredQuicksave = false;
		return Savegames.saveWorld(w, 0);
	}
	installLifecycle() {
		const hide = () => {
			if ($('game').hidden) return;
			this.controllers.gameRoundController.onMainActivityPaused();
			this.controllers.movementController.stopMovement();
			this.quicksave();
		};
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') hide();
			else if (!$('game').hidden) { this.controllers.gameRoundController.onMainActivityResumed(); this.updateAll(); }
		});
		window.addEventListener('pagehide', hide);
		const keyState = (down) => (e) => {
			if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
			if ($('game').hidden) return;
			if (this.sheets.length) { if (down && e.key === 'Escape') this.sheets[this.sheets.length - 1].close(); return; }
			const acc = this.world.model && this.world.model.uiSelections.isMainActivityVisible;
			if (this.controllers.inputController.onKeyboardAction(e, down, acc)) e.preventDefault();
		};
		window.addEventListener('keydown', keyState(true));
		window.addEventListener('keyup', keyState(false));
	}

	// ------------------------------------------------------------------ sheets
	openSheet(opts) {
		const host = $('sheets');
		const scrim = document.createElement('div');
		scrim.className = 'scrim';
		const el = document.createElement('section');
		el.className = 'sheet' + (opts.full ? ' full' : '');
		el.setAttribute('role', 'dialog');
		el.innerHTML = `<header><div class="ic"></div><h2>${esc(opts.title || '')}${opts.sub ? `<span class="sub">${esc(opts.sub)}</span>` : ''}</h2>${opts.closable === false ? '' : '<button class="x" aria-label="Close">✕</button>'}</header>${opts.tabs ? '<nav class="tabs"></nav>' : ''}<div class="body"></div><footer hidden></footer>`;
		if (opts.icon) el.querySelector('.ic').appendChild(opts.icon); else el.querySelector('.ic').remove();
		const sheet = {
			el, scrim, result: undefined, closed: false,
			body: el.querySelector('.body'),
			setBody: (html) => { sheet.body.innerHTML = ''; if (typeof html === 'string') sheet.body.innerHTML = html; else if (html) sheet.body.appendChild(html); this.wireLinks(sheet.body); },
			setFooter: (buttons) => {
				const f = el.querySelector('footer');
				f.innerHTML = '';
				f.hidden = !buttons || !buttons.length;
				for (const b of buttons || []) {
					const btn = document.createElement('button');
					btn.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
					btn.textContent = b.label;
					btn.disabled = !!b.disabled;
					btn.onclick = () => { const keep = b.onClick && b.onClick(sheet); if (!b.keepOpen && keep !== true) sheet.close(); };
					f.appendChild(btn);
				}
			},
			close: (silent) => {
				if (sheet.closed) return;
				sheet.closed = true;
				el.remove(); scrim.remove();
				const i = this.sheets.indexOf(sheet);
				if (i >= 0) this.sheets.splice(i, 1);
				if (this.sheets.length === 0 && this.pauseHeld) {
					this.pauseHeld = false;
					if (this.world.model) this.controllers.gameRoundController.releasePause(PauseReason.BLOCKING_DIALOG);
				}
				if (!silent && opts.onClose) opts.onClose(sheet.result, sheet);
				if (!silent) this.updateAll();
			},
		};
		if (opts.tabs) {
			const nav = el.querySelector('.tabs');
			opts.tabs.forEach((t) => {
				const b = document.createElement('button');
				b.textContent = t.label;
				b.setAttribute('role', 'tab');
				b.onclick = () => { nav.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', 'false')); b.setAttribute('aria-selected', 'true'); sheet.tab = t.id; t.render(sheet); };
				nav.appendChild(b);
				t.btn = b;
			});
			sheet.selectTab = (id) => { const t = opts.tabs.find((x) => x.id === id) || opts.tabs[0]; t.btn.click(); };
		}
		const x = el.querySelector('.x');
		if (x) x.onclick = () => sheet.close();
		if (opts.closable !== false && opts.scrimCloses !== false) scrim.onclick = () => sheet.close();
		host.appendChild(scrim);
		host.appendChild(el);
		if (this.sheets.length === 0 && this.world.model && !$('game').hidden) {
			this.pauseHeld = true;
			this.controllers.gameRoundController.acquirePause(PauseReason.BLOCKING_DIALOG);
			this.controllers.movementController.stopMovement();
		}
		this.sheets.push(sheet);
		if (opts.body != null) sheet.setBody(opts.body);
		sheet.setFooter(opts.footer);
		return sheet;
	}
	wireLinks(root) {
		root.querySelectorAll('a[data-cond]').forEach((a) => {
			a.onclick = (e) => { e.preventDefault(); const t = this.world.actorConditionsTypes.getActorConditionType(a.dataset.cond); if (t) Screens.showConditionInfo(this, t); };
		});
	}
	icon(tileID, size = 32, overlay = -1) { return this.renderer.makeIcon(tileID, size, overlay); }
	itemIcon(t, size = 32) { return this.renderer.makeIcon(t.iconID, size, t.getOverlayTileID()); }

	// ------------------------------------------------------------------ HUD
	installHUD() {
		$('portrait').onclick = () => Screens.showHeroInfo(this, 'overview');
		$('tHero').onclick = () => Screens.showHeroInfo(this, 'overview');
		$('tItems').onclick = () => Screens.showHeroInfo(this, 'items');
		$('tQuests').onclick = () => Screens.showHeroInfo(this, 'quests');
		$('tMap').onclick = () => Screens.showWorldMap(this);
		$('tMenu').onclick = () => Screens.showMenu(this);
		$('status').onclick = () => { $('status').hidden = true; };
		// d-pad: press and hold to walk; tap to step
		const dpad = $('dpad');
		$('dpadHide').onclick = () => { this.setArrowsVisible(false); this.toast('Arrow buttons hidden. Turn them back on from Menu.'); };
		dpad.querySelectorAll('button[data-d]').forEach((b) => {
			const [dx, dy] = b.dataset.d.split(',').map(Number);
			b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); this.controllers.inputController.onRelativeMovement(dx, dy); });
			const up = () => { if (!this.world.model.uiSelections.isInCombat) this.controllers.movementController.stopMovement(); };
			b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
		});
		this.renderQuickslots();
	}
	watchHud() {
		if (this._hudRO || !window.ResizeObserver) return;
		this._hudRO = new ResizeObserver(() => { document.documentElement.style.setProperty('--hudH', $('hudBottom').offsetHeight + 'px'); });
		this._hudRO.observe($('hudBottom'));
	}
	setArrowsVisible(on) {
		const cur = this.prefs.dpadPosition;
		if (!on && cur && cur !== 'disabled') this.prefs.lastDpadPosition = cur;
		this.prefs.dpadPosition = on ? (this.prefs.lastDpadPosition || 'lower_right') : 'disabled';
		this.prefs.write();
		this.updateDpad();
	}
	updateDpad() {
		this.watchHud();
		const pos = this.prefs.dpadPosition;
		$('dpad').hidden = !pos || pos === 'disabled';
		$('dpad').classList.toggle('left', pos === 'lower_left');
	}
	updateAll() {
		if (!this.world || !this.world.model) return;
		const p = this.world.model.player;
		$('hpFill').style.width = (100 * Math.max(0, p.health.current) / Math.max(1, p.health.max)) + '%';
		$('hpText').textContent = `${S('status_hp')} ${Format.localizeInt(p.health.current)}/${Format.localizeInt(p.health.max)}`;
		const xpc = p.levelExperience.current, xpm = p.levelExperience.max;
		$('xpFill').style.width = (100 * Math.min(1, Math.max(0, xpc) / Math.max(1, xpm))) + '%';
		$('xpText').textContent = `${S('status_exp')} ${Format.localizeInt(xpc)}/${Format.localizeInt(xpm)}`;
		$('lvl').textContent = p.level;
		$('gold').textContent = Format.localizeInt(p.inventory.gold) + ' gold';
		const portrait = $('portrait');
		const old = portrait.querySelector('canvas');
		if (!old || old.dataset.icon !== String(p.iconID)) {
			if (old) old.remove();
			const c = this.icon(p.iconID, 36);
			c.dataset.icon = String(p.iconID);
			portrait.prepend(c);
		}
		portrait.classList.toggle('levelup', p.canLevelup());
		this.renderQuickslots();
		this.updateCombatBar();
		this.updateDpad();
	}
	renderQuickslots() {
		const q = $('quick');
		if (!this.world || !this.world.model) { q.innerHTML = ''; return; }
		q.hidden = !this.prefs.quickslotsVisible;
		const inv = this.world.model.player.inventory;
		q.innerHTML = '';
		for (let i = 0; i < 3; i++) {
			const t = inv.quickitem[i];
			const b = document.createElement('button');
			b.className = 'qslot' + (t ? '' : ' empty');
			b.setAttribute('aria-label', t ? t.getName(this.world.model.player) : S('inventory_assign'));
			if (t) {
				b.appendChild(this.itemIcon(t, 34));
				const n = inv.getItemQuantity(t.id);
				b.insertAdjacentHTML('beforeend', `<b>${n}</b>`);
				if (n === 0) b.classList.add('empty');
			} else {
				b.appendChild(this.icon(TileManager.iconID_unassigned_quickslot, 28));
			}
			b.insertAdjacentHTML('beforeend', `<span class="n">${i + 1}</span>`);
			let lp = null, long = false;
			b.onpointerdown = () => { long = false; lp = setTimeout(() => { long = true; Screens.showQuickslotAssign(this, i); }, 500); };
			b.onpointerup = b.onpointercancel = () => clearTimeout(lp);
			b.onclick = () => {
				if (long) return;
				if (!t) { Screens.showQuickslotAssign(this, i); return; }
				if (inv.getItemQuantity(t.id) <= 0) { this.toast(S('inventory_selectitem')); Screens.showQuickslotAssign(this, i); return; }
				this.controllers.itemController.quickitemUse(i);
				this.updateAll();
			};
			q.appendChild(b);
		}
	}
	refreshConditions() {
		const box = $('conds');
		box.innerHTML = '';
		if (!this.world.model) return;
		const p = this.world.model.player;
		const add = (c, immune) => {
			const b = document.createElement('button');
			if (immune) b.className = 'immune';
			b.setAttribute('aria-label', c.conditionType.name);
			b.appendChild(this.icon(c.conditionType.iconID, 26));
			const parts = [];
			if (c.magnitude > 1) parts.push('×' + c.magnitude);
			if (ActorCondition.isTemporaryEffect(c.duration)) parts.push(c.duration);
			if (parts.length) b.insertAdjacentHTML('beforeend', `<b>${esc(parts.join(' '))}</b>`);
			b.onclick = () => Screens.showConditionInfo(this, c.conditionType);
			box.appendChild(b);
		};
		for (const c of p.conditions) add(c, false);
		for (const c of p.immunities) add(c, true);
	}

	// ------------------------------------------------------------------ combat bar (CombatView)
	updateCombatBar() {
		const w = this.world;
		if (!w.model) return;
		const ui = w.model.uiSelections;
		const box = $('combat');
		const inCombat = ui.isInCombat;
		box.hidden = !inCombat;
		$('tools').hidden = inCombat;
		if (!inCombat) return;
		const p = w.model.player;
		const m = ui.selectedMonster;
		const sig = [m ? m.health.current : '', m ? m.iconID : '', p.ap.current, p.ap.max, p.attackCost, p.moveCost, this.monsterActing ? this.monsterActing.name : '', ui.selectedPosition ? ui.selectedPosition.toString() : '', ui.isPlayersCombatTurn, m ? m.conditions.length : 0].join('|');
		if (sig === this._combatSig) return;
		this._combatSig = sig;
		let html = '';
		if (m) {
			html += `<div class="foe" id="foe"><span id="foeIcon"></span><div class="bars"><div class="name">${esc(m.getName())}</div>
				<div class="meter hp"><i style="width:${100 * Math.max(0, m.health.current) / Math.max(1, m.health.max)}%"></i><span>${S('combat_monsterhealth')} ${m.health.current}/${m.health.max}</span></div></div><span class="muted" style="font-size:12px">${esc(S('dialog_monsterencounter_info'))} ›</span></div>`;
		}
		if (this.monsterActing) {
			html += `<div class="turn">${esc(S('combat_monsteraction', this.monsterActing.getName()))}</div>`;
		} else {
			const label = m ? S('combat_attack', p.getAttackCost()) : S('combat_move', p.getMoveCost());
			html += `<div class="apline"><div class="meter ap"><i style="width:${100 * p.ap.current / Math.max(1, p.ap.max)}%"></i><span>${S('status_ap')} ${p.ap.current}/${p.ap.max}</span></div>
				<button class="btn small" id="cLog">Log</button></div>
				<div class="acts"><button class="btn primary" id="cAct">${esc(label)}</button><button class="btn" id="cEnd">${esc(S('combat_endturn'))}</button><button class="btn" id="cFlee">${esc(S('combat_flee'))}</button></div>`;
		}
		box.innerHTML = html;
		if (m) {
			$('foeIcon').appendChild(this.icon(m.iconID, 36));
			$('foe').onclick = () => Screens.showMonsterInfo(this, m);
		}
		const cc = this.controllers.combatController;
		const act = $('cAct');
		if (act) {
			act.onclick = () => cc.executeMoveAttack(0, 0);
			$('cEnd').onclick = () => cc.endPlayerTurn();
			$('cFlee').onclick = () => cc.startFlee();
			$('cLog').onclick = () => Screens.showCombatLog(this);
		}
	}

	// ------------------------------------------------------------------ messages
	message(msg) {
		const m = this.world.model;
		m.combatLog.append(msg);
		const st = $('status');
		st.textContent = m.combatLog.getLastMessages();
		st.hidden = false;
		clearTimeout(this.statusTimer);
		if (!m.uiSelections.isInCombat) this.statusTimer = setTimeout(() => this.clearMessages(), Constants.STATUS_TEXT_AUTOHIDE_DELAY);
	}
	clearMessages() {
		if (this.world.model) this.world.model.combatLog.appendCombatEnded();
		$('status').hidden = true;
	}
	toast(msg, ms = 3200) {
		if (!msg) return;
		const t = $('toast');
		t.textContent = msg;
		t.hidden = false;
		clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(() => { t.hidden = true; }, ms);
	}

	// ------------------------------------------------------------------ input from map taps
	onTapTile(t) {
		const w = this.world;
		if (!w.model.uiSelections.isMainActivityVisible) return;
		const p = w.model.player.position;
		this.mapView.tapMarker = { x: t.x, y: t.y, t: Date.now() };
		if (t.equals(p)) {
			// tapping yourself: pick up loot under you if any
			const bag = w.model.currentMaps.map.getBagAt(p);
			if (bag) this.controllers.itemController.playerSteppedOnLootBag(bag);
			return;
		}
		this.controllers.movementController.startMovement(t.x - p.x, t.y - p.y, t);
	}

	// ------------------------------------------------------------------ model listeners (MainActivity)
	subscribe() {
		const C = this.controllers;
		const ui = this;
		const upd = () => this.updateAll();
		C.actorStatsController.actorStatsListeners.add({ onActorHealthChanged: upd, onActorAPChanged: upd, onActorAttackCostChanged: upd, onActorMoveCostChanged: upd });
		C.actorStatsController.playerStatsListeners.add({ onPlayerExperienceChanged: upd });
		const condChanged = (actor) => { if (actor === this.world.model.player) this.refreshConditions(); else this._combatSig = null; };
		C.actorStatsController.actorConditionListeners.add({
			onActorConditionAdded: condChanged, onActorConditionRemoved: condChanged, onActorConditionDurationChanged: condChanged,
			onActorConditionMagnitudeChanged: condChanged, onActorConditionImmunityAdded: condChanged, onActorConditionImmunityRemoved: condChanged,
			onActorConditionImmunityDurationChanged: condChanged,
		});
		C.itemController.quickSlotListeners.add({ onQuickSlotChanged: upd, onQuickSlotUsed: upd });
		C.combatController.combatSelectionListeners.add({ onMonsterSelected: upd, onMovementDestinationSelected: upd, onCombatSelectionCleared: upd });
		C.combatController.combatTurnListeners.add({
			onCombatStarted: () => { this.monsterActing = null; this.clearMessages(); this.updateAll(); },
			onCombatEnded: () => { this.monsterActing = null; this.clearMessages(); this.updateAll(); },
			onNewPlayerTurn: () => { this.monsterActing = null; this.updateAll(); },
			onMonsterIsAttacking: (m) => { this.monsterActing = m; this.updateAll(); },
		});
		const combatMsgs = {
			onPlayerAttackMissed: () => this.message(S('combat_result_heromiss')),
			onPlayerAttackSuccess: (t, r) => {
				this.message(S(r.isCriticalHit ? 'combat_result_herohitcritical' : 'combat_result_herohit', t.getName(), r.damage));
				if (r.targetDied) this.message(S('combat_result_herokillsmonster', t.getName()));
			},
			onMonsterAttackMissed: (a) => this.message(S('combat_result_monstermiss', a.getName())),
			onMonsterAttackSuccess: (a, r) => this.message(S(r.isCriticalHit ? 'combat_result_monsterhitcritical' : 'combat_result_monsterhit', a.getName(), r.damage)),
			onMonsterMovedDuringCombat: (m) => this.message(S('combat_result_monstermoved', m.getName())),
			onPlayerStartedFleeing: () => this.message(S('combat_begin_flee')),
			onPlayerFailedFleeing: () => this.message(S('combat_flee_failed')),
			onPlayerDoesNotHaveEnoughAP: () => this.message(S('combat_not_enough_ap')),
			onPlayerTauntsMonster: (a) => { if (a) this.message(S('combat_taunt_monster', a.getName())); },
			onPlayerReceviesActorCondition: (e) => this.message(S(e.isImmunity() ? 'combat_condition_player_immune' : e.isRemovalEffect() ? 'combat_condition_player_clear' : 'combat_condition_player_apply', condMsg(e))),
			onMonsterReceivesActorCondition: (e, m) => this.message(S(e.isImmunity() ? 'combat_condition_monster_immune' : e.isRemovalEffect() ? 'combat_condition_monster_clear' : 'combat_condition_monster_apply', m.getName(), condMsg(e))),
		};
		C.combatController.combatActionListeners.add(combatMsgs);
		C.actorStatsController.combatActionListeners.add(combatMsgs);
		C.skillController.combatActionListeners.add(combatMsgs);
		C.movementController.playerMovementListeners.add({
			onPlayerEnteredNewMap: () => { if (this.deferredQuicksave) this.quicksave(); else this.quicksave(); this.updateAll(); },
		});
		C.mapController.worldEventListeners.add({
			onPlayerStartedConversation: (m, phraseID) => Screens.showConversation(ui, phraseID, m, true),
			onScriptAreaStartedConversation: (phraseID) => Screens.showConversation(ui, phraseID, null, false),
			onPlayerSteppedOnMonster: (m) => Screens.showMonsterEncounter(ui, m),
			onPlayerSteppedOnRestArea: (area) => Screens.showConfirmRest(ui, area),
			onPlayerSteppedOnGroundLoot: (loot) => {
				let msg = '';
				if (!loot.items.isEmpty()) msg += S('dialog_groundloot_message');
				if (loot.gold > 0) msg += ' ' + S('dialog_loot_foundgold', loot.gold);
				Screens.showLoot(ui, S('dialog_groundloot_title'), msg.trim(), loot, [loot]);
			},
			onPlayerPickedUpGroundLoot: (loot) => {
				if (!this.showToastForPickedUpItems(loot)) return;
				this.toast(pickedUpMsg(loot).trim());
			},
			onPlayerFoundMonsterLoot: (bags, exp) => {
				const combined = Loot.combine(bags);
				let msg = S('dialog_monsterloot_message');
				if (exp > 0) msg += ' ' + S('dialog_monsterloot_gainedexp', exp);
				if (combined.gold > 0) msg += ' ' + S('dialog_loot_foundgold', combined.gold);
				Screens.showLoot(ui, S('dialog_monsterloot_title'), msg, combined, [...bags]);
			},
			onPlayerPickedUpMonsterLoot: (bags, exp) => {
				const combined = Loot.combine(bags);
				if (!this.showToastForPickedUpItems(combined)) return;
				let msg = S('dialog_monsterloot_message');
				if (exp > 0) msg += ' ' + S('dialog_monsterloot_gainedexp', exp);
				this.toast((msg + ' ' + pickedUpMsg(combined)).trim());
			},
			onPlayerRested: () => Screens.showMessage(ui, S('dialog_rest_title'), S('dialog_rest_message')),
			onPlayerDied: (lostExp) => {
				if (!this.world.model.statistics.isDead()) this.message(S('combat_hero_dies', lostExp));
				else Screens.showHeroDied(ui);
			},
		});
		function condMsg(e) {
			let sb = e.conditionType.name;
			if (!e.isImmunity() && !e.isRemovalEffect() && e.magnitude > 1) sb += ' x' + e.magnitude;
			if (ActorCondition.isTemporaryEffect(e.duration)) sb += ' ' + S('iteminfo_effect_duration', e.duration);
			return sb;
		}
		function pickedUpMsg(loot) {
			let s = '';
			if (loot.gold > 0) s += ' ' + S('dialog_loot_foundgold', loot.gold);
			const n = loot.items.countItems();
			if (n === 1) s += ' ' + S('dialog_loot_pickedupitem');
			else if (n > 1) s += ' ' + S('dialog_loot_pickedupitems', n);
			return s;
		}
	}
	showToastForPickedUpItems(loot) {
		switch (this.prefs.displayLoot) {
			case 'toast': case 'dialog_for_items_else_toast': return true;
			case 'toast_for_items': return loot.hasItems();
		}
		return false;
	}
}

const app = new UI();
window.__andor = app; // handy for debugging
app.boot();
