// Port of controller/InputController.java (touch + keyboard for the web)
import { Coord, Constants } from '../util.js';

const KEYMAP = {
	ArrowUp: 'up', w: 'up', W: 'up', 8: 'up',
	ArrowDown: 'down', s: 'down', S: 'down', 2: 'down',
	ArrowLeft: 'left', a: 'left', A: 'left', 4: 'left',
	ArrowRight: 'right', d: 'right', D: 'right', 6: 'right',
	7: 'upleft', Home: 'upleft', 9: 'upright', PageUp: 'upright',
	1: 'downleft', End: 'downleft', 3: 'downright', PageDown: 'downright',
	' ': 'attack', 5: 'attack', f: 'flee', F: 'flee', e: 'endturn', E: 'endturn',
	c: 'heroinfo', C: 'heroinfo', b: 'toolbox', B: 'toolbox', Escape: 'back',
};

export class InputController {
	constructor(controllers, world) {
		this.controllers = controllers;
		this.world = world;
		this.lastTouchPosition_tileCoords = new Coord();
		this.lastTouchPosition_dx = 0;
		this.lastTouchPosition_dy = 0;
		this.lastTouchEventTime = 0;
		this.isDpadActive = false;
		this.keyState_dx = 0;
		this.keyState_dy = 0;
		this.keyState_attack = false;
		this.keyState_flee = false;
		this.keyState_endturn = false;
		this.ui = null; // set by main UI: { openHeroInfo(), toggleToolbox(), back() }
	}
	onKeyboardAction(ev, keydown, acceptInput) {
		const action = KEYMAP[ev.key];
		if (!action) return false;
		const inhibit = this.keyState_attack || this.keyState_flee;
		const setDir = (dx, dy) => {
			if (dx !== null) this.keyState_dx = keydown ? dx : 0;
			if (dy !== null) this.keyState_dy = keydown ? dy : 0;
			if (acceptInput && !inhibit) this.onRelativeMovement(this.keyState_dx, this.keyState_dy);
		};
		switch (action) {
			case 'up': setDir(null, -1); break;
			case 'down': setDir(null, 1); break;
			case 'left': setDir(-1, null); break;
			case 'right': setDir(1, null); break;
			case 'upleft': setDir(-1, -1); break;
			case 'upright': setDir(1, -1); break;
			case 'downleft': setDir(-1, 1); break;
			case 'downright': setDir(1, 1); break;
			case 'attack':
				if (keydown && !this.keyState_attack) {
					if (!this.world.model.uiSelections.isInCombat) this.controllers.movementController.stopMovement();
				} else if (!keydown && this.keyState_attack) {
					if (acceptInput) this.onRelativeMovement(this.keyState_dx, this.keyState_dy);
				}
				this.keyState_attack = keydown;
				break;
			case 'flee':
				if (this.world.model.uiSelections.isInCombat) {
					if (keydown && !this.keyState_flee) { if (acceptInput) this.controllers.combatController.startFlee(); }
					else if (!keydown && this.keyState_flee) {
						if ((this.keyState_dx !== 0 || this.keyState_dy !== 0) && this.allowInputInterval()) {
							if (acceptInput) this.controllers.combatController.executeMoveAttack(this.keyState_dx, this.keyState_dy);
						}
					}
				}
				this.keyState_flee = keydown;
				break;
			case 'endturn':
				if (acceptInput && keydown && !this.keyState_endturn && this.world.model.uiSelections.isInCombat) this.controllers.combatController.endPlayerTurn();
				this.keyState_endturn = keydown;
				break;
			case 'heroinfo': if (acceptInput && keydown && this.ui) this.ui.openHeroInfo(); break;
			case 'toolbox': if (acceptInput && keydown && !ev.repeat && this.ui) this.ui.toggleToolbox(); break;
			case 'back': if (keydown && this.ui) this.ui.back(); break;
			default: return false;
		}
		return true;
	}
	onRelativeMovement(dx, dy) {
		if (this.world.model.uiSelections.isInCombat) {
			if (this.allowInputInterval()) this.controllers.combatController.executeMoveAttack(dx, dy);
		} else if (dx === 0 && dy === 0) {
			this.controllers.movementController.stopMovement();
		} else {
			this.controllers.movementController.startMovement(dx, dy, null);
		}
	}
	onKeyboardCancel() { this.controllers.movementController.stopMovement(); }
	onClick() {
		if (!this.world.model.uiSelections.isInCombat) return;
		this.onRelativeMovement(this.lastTouchPosition_dx, this.lastTouchPosition_dy);
	}
	onLongClick() {
		if (this.world.model.uiSelections.isInCombat) {
			const dx = this.lastTouchPosition_dx, dy = this.lastTouchPosition_dy;
			if (dx === 0 && dy === 0) return false;
			if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
			this.controllers.combatController.setCombatSelection(new Coord(this.lastTouchPosition_tileCoords));
			return true;
		}
		return false;
	}
	allowInputInterval() {
		const now = Date.now();
		if (now - this.lastTouchEventTime < Constants.MINIMUM_INPUT_INTERVAL) return false;
		this.lastTouchEventTime = now;
		return true;
	}
	setDpadActive(v) { this.isDpadActive = v; }
	onTouchCancel() { this.controllers.movementController.stopMovement(); }
	onTouchedTile(x, y) {
		this.lastTouchPosition_tileCoords.set(x, y);
		this.lastTouchPosition_dx = x - this.world.model.player.position.x;
		this.lastTouchPosition_dy = y - this.world.model.player.position.y;
		if (this.world.model.uiSelections.isInCombat || this.isDpadActive) return false;
		this.controllers.movementController.startMovement(this.lastTouchPosition_dx, this.lastTouchPosition_dy, new Coord(this.lastTouchPosition_tileCoords));
		return true;
	}
}
