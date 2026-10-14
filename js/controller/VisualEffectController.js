// Port of controller/VisualEffectController.java
import { Coord, CoordRect, Size, Constants, Format, ListOfListeners, rnd, idiv } from '../util.js';
import { TileManager } from '../resource/TileManager.js';

const EFFECT_UPDATE_INTERVAL = 25;
export const ATTACKSPEED_DEFAULT_MILLISECONDS = 1000;

export class BloodSplatter {
	constructor(iconID, position) {
		this.iconID = iconID;
		this.position = new Coord(position);
		const now = Date.now();
		this.removeAfter = now + Constants.SPLATTER_DURATION_MS;
		this.reduceIconAfter = now + idiv(Constants.SPLATTER_DURATION_MS, 2);
		this.reducedIcon = false;
	}
}

export class VisualEffectController {
	constructor(controllers, world) {
		this.controllers = controllers;
		this.world = world;
		this.activeAnimations = [];
		this.visualEffectFrameListeners = new ListOfListeners();
		this.enqueuedEffectID = null;
		this.enqueuedEffectValue = 0;
		this.timer = null;
		this.activeMoves = new Set();
	}
	get prefs() { return this.controllers.preferences; }
	getEffectUpdateInterval() { return idiv(EFFECT_UPDATE_INTERVAL * this.prefs.attackspeed_milliseconds, ATTACKSPEED_DEFAULT_MILLISECONDS); }
	startEffect(position, effectID, displayValue, callback, callbackValue) {
		const effect = this.world.visualEffectTypes.getVisualEffect(effectID);
		const a = new VisualEffectAnimation(this, effect, position, displayValue, callback, callbackValue);
		a.start();
	}
	startAnimation(a) {
		this.activeAnimations.push(a);
		a.update();
		if (this.activeAnimations.length === 1) this.timer = setTimeout(() => this._run(), 0);
	}
	_run() {
		this.timer = null;
		if (this.activeAnimations.length === 0) return;
		const interval = this.getEffectUpdateInterval();
		if (interval > 0) this.timer = setTimeout(() => this._run(), interval);
		for (let i = 0; i < this.activeAnimations.length; i++) {
			const a = this.activeAnimations[i];
			a.durationPassed += interval;
			a.updateFrame();
			a.update();
			if (this.prefs.attackspeed_milliseconds <= 0 || a.currentFrame >= a.effect.lastFrame) {
				this.activeAnimations.splice(i, 1);
				i--;
				a.onCompleted();
			}
		}
		this.visualEffectFrameListeners.emit('onNewAnimationFrames', this.activeAnimations);
	}
	enqueueEffect(effectID, displayValue) {
		if (this.enqueuedEffectID == null) this.enqueuedEffectID = effectID;
		else if (Math.abs(displayValue) > Math.abs(this.enqueuedEffectValue)) this.enqueuedEffectID = effectID;
		this.enqueuedEffectValue += displayValue;
	}
	startEnqueuedEffect(position) {
		if (this.enqueuedEffectID == null) return;
		const dv = this.enqueuedEffectValue === 0 ? null : Format.localizeInt(this.enqueuedEffectValue);
		const id = this.enqueuedEffectID;
		this.enqueuedEffectID = null;
		this.enqueuedEffectValue = 0;
		this.startEffect(new Coord(position), id, dv, null, 0);
	}
	startActorMoveEffect(actor, map, origin, destination, duration, callback, callbackValue) {
		const anim = {
			origin: new Coord(origin), destination: new Coord(destination), duration, actor, map,
		};
		const complete = () => {
			actor.hasVFXRunning = false;
			this.activeMoves.delete(anim);
			if (callback != null) callback.onVisualEffectCompleted(callbackValue);
			this.visualEffectFrameListeners.emit('onSpriteMoveCompleted', anim);
		};
		actor.hasVFXRunning = true;
		actor.vfxDuration = duration;
		actor.vfxStartTime = Date.now();
		actor.vfxOrigin = anim.origin;
		this.activeMoves.add(anim);
		this.visualEffectFrameListeners.emit('onSpriteMoveStarted', anim);
		if (duration === 0 || !this.prefs.enableUiAnimations) complete();
		else setTimeout(complete, duration);
	}
	isRunningVisualEffect() { return this.activeAnimations.length > 0; }
	updateSplatters(map) {
		if (!map) return;
		const now = Date.now();
		const L = this.controllers.monsterSpawnController.monsterSpawnListeners;
		for (let i = map.splatters.length - 1; i >= 0; --i) {
			const b = map.splatters[i];
			if (b.removeAfter <= now) { map.splatters.splice(i, 1); L.emit('onSplatterRemoved', map, b.position); }
			else if (!b.reducedIcon && b.reduceIconAfter <= now) { b.reducedIcon = true; b.iconID++; L.emit('onSplatterChanged', map, b.position); }
		}
	}
	addSplatter(map, m) {
		const iconID = VisualEffectController.getSplatterIconFromMonsterClass(m.getMonsterClass());
		if (iconID > 0) {
			map.splatters.push(new BloodSplatter(iconID, m.position));
			this.controllers.monsterSpawnController.monsterSpawnListeners.emit('onSplatterAdded', map, m.position);
		}
	}
	static getSplatterIconFromMonsterClass(c) {
		switch (c) {
			case 'insect': case 'undead': case 'reptile': return TileManager.iconID_splatter_brown_1a + rnd.nextInt(2) * 2;
			case 'humanoid': case 'animal': case 'giant': return TileManager.iconID_splatter_red_1a + rnd.nextInt(2) * 2;
			case 'demon': case 'construct': case 'ghost': return TileManager.iconID_splatter_white_1a;
			default: return -1;
		}
	}
	asyncUpdateArea(area) { this.visualEffectFrameListeners.emit('onAsyncAreaUpdate', area); }
}

export class VisualEffectAnimation {
	constructor(ctrl, effect, position, displayValue, callback, callbackValue) {
		this.ctrl = ctrl;
		this.effect = effect;
		this.position = new Coord(position);
		this.callback = callback;
		this.callbackValue = callbackValue;
		this.displayText = displayValue == null ? '' : displayValue;
		this.textColor = effect.textColor;
		this.currentFrame = 0;
		this.durationPassed = 0;
		this.tileID = effect.frameIconIDs[0];
		this.textYOffset = 0;
		this.textAlpha = 1;
		this.beginFadeAtFrame = idiv(effect.lastFrame, 2);
		this.area = new CoordRect(new Coord(position.x - 1, position.y - 1), new Size(3, 2));
	}
	updateFrame() {
		const p = this.ctrl.prefs;
		const frameDuration = idiv(this.effect.millisecondPerFrame * p.attackspeed_milliseconds, ATTACKSPEED_DEFAULT_MILLISECONDS);
		while (frameDuration > 0 && this.durationPassed > frameDuration) { this.currentFrame++; this.durationPassed -= frameDuration; }
	}
	update() {
		if (this.currentFrame >= this.effect.lastFrame) return;
		this.tileID = this.effect.frameIconIDs[this.currentFrame];
		this.textYOffset = -2 * this.currentFrame;
		if (this.currentFrame >= this.beginFadeAtFrame && this.displayText) {
			this.textAlpha = (this.effect.lastFrame - this.currentFrame) / Math.max(1, this.effect.lastFrame - this.beginFadeAtFrame);
		}
	}
	onCompleted() {
		this.ctrl.visualEffectFrameListeners.emit('onAnimationCompleted', this);
		if (this.callback != null) this.callback.onVisualEffectCompleted(this.callbackValue);
	}
	start() {
		const p = this.ctrl.prefs;
		if (!p.enableUiAnimations || this.effect.duration === 0 || p.attackspeed_milliseconds <= 0) this.onCompleted();
		else this.ctrl.startAnimation(this);
	}
}
