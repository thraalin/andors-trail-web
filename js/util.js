// Port of com.gpl.rpg.AndorsTrail.util.* and controller.Constants
// Java int semantics: use idiv() wherever Java does integer division.

export const idiv = (a, b) => Math.trunc(a / b);
export const toInt = (v) => Math.trunc(v); // Java (int) cast of a float/double

export class Size {
	constructor(width, height) { this.width = width; this.height = height; }
	toString() { return this.width + 'x' + this.height; }
	equals(s, h) {
		if (typeof s === 'number') return this.width === s && this.height === h;
		return this.width === s.width && this.height === s.height;
	}
}

export class Coord {
	constructor(x, y) {
		if (x instanceof Coord) { this.x = x.x; this.y = x.y; }
		else { this.x = x | 0; this.y = y | 0; }
	}
	toString() { return '(' + this.x + ',' + this.y + ')'; }
	set(x, y) {
		if (x instanceof Coord || (x && typeof x === 'object')) { this.x = x.x; this.y = x.y; }
		else { this.x = x; this.y = y; }
	}
	equals(p, y) {
		if (typeof p === 'number') return p === this.x && y === this.y;
		return p.x === this.x && p.y === this.y;
	}
	contains(p, y) { return this.equals(p, y); }
	isAdjacentTo(p) {
		const dx = this.x - p.x;
		const dy = this.y - p.y;
		if (dx === 0 && dy === 0) return false;
		if (Math.abs(dx) > 1) return false;
		if (Math.abs(dy) > 1) return false;
		return true;
	}
	toJSON() { return [this.x, this.y]; }
	static fromJSON(a) { return new Coord(a[0], a[1]); }
}

export class CoordRect {
	// new CoordRect(size) | new CoordRect(topLeft, size) | new CoordRect(copy)
	constructor(a, b) {
		if (a instanceof CoordRect) { this.topLeft = a.topLeft; this.size = a.size; }
		else if (a instanceof Size) { this.topLeft = new Coord(); this.size = a; }
		else { this.topLeft = a; this.size = b; }
	}
	contains(p, y) {
		let x;
		if (typeof p === 'number') { x = p; } else { x = p.x; y = p.y; }
		if (x < this.topLeft.x) return false;
		if (y < this.topLeft.y) return false;
		if (x - this.topLeft.x >= this.size.width) return false;
		if (y - this.topLeft.y >= this.size.height) return false;
		return true;
	}
	static union(r1, r2) {
		const left = Math.min(r1.topLeft.x, r2.topLeft.x);
		const top = Math.min(r1.topLeft.y, r2.topLeft.y);
		const right = Math.max(r1.topLeft.x + r1.size.width, r2.topLeft.x + r2.size.width);
		const bottom = Math.max(r1.topLeft.y + r1.size.height, r2.topLeft.y + r2.size.height);
		return new CoordRect(new Coord(left, top), new Size(right - left, bottom - top));
	}
	intersects(a) {
		if (this === a) return true;
		if (a.topLeft.x >= this.topLeft.x + this.size.width) return false;
		if (a.topLeft.y >= this.topLeft.y + this.size.height) return false;
		if (this.topLeft.x >= a.topLeft.x + a.size.width) return false;
		if (this.topLeft.y >= a.topLeft.y + a.size.height) return false;
		return true;
	}
	isAdjacentTo(p) {
		const dx = p.x - this.topLeft.x;
		const dy = p.y - this.topLeft.y;
		if (dx < -1) return false;
		if (dy < -1) return false;
		if (dx > this.size.width) return false;
		if (dy > this.size.height) return false;
		return true;
	}
	findPositionAdjacentTo(p) {
		const dx = Math.min(this.size.width - 1, Math.max(0, p.x - this.topLeft.x));
		const dy = Math.min(this.size.height - 1, Math.max(0, p.y - this.topLeft.y));
		return new Coord(this.topLeft.x + dx, this.topLeft.y + dy);
	}
	getCenter() {
		const c = new Coord(this.topLeft);
		c.x += idiv(this.size.width, 2);
		c.y += idiv(this.size.height, 2);
		return c;
	}
	toString() { return '{' + this.topLeft.toString() + ', ' + this.size.toString() + '}'; }
	static getBoundingRect(c1, c2, s) {
		let x, y, w, h;
		if (c2.x < c1.x) { x = c2.x; w = 1 + c1.x - c2.x; } else { x = c1.x; w = 1 + c2.x - c1.x; }
		if (c2.y < c1.y) { y = c2.y; h = 1 + c1.y - c2.y; } else { y = c1.y; h = 1 + c2.y - c1.y; }
		if (s) return new CoordRect(new Coord(x, y), new Size(w + s.width - 1, h + s.height - 1));
		return new CoordRect(new Coord(x, y), new Size(w, h));
	}
}

export class Range {
	constructor(max, current) {
		if (max && typeof max === 'object') { this.max = max.max; this.current = max.current; }
		else { this.max = max | 0; this.current = current | 0; }
	}
	equals(r) { if (r == null) return false; return this.max === r.max && this.current === r.current; }
	set(max, current) {
		if (max && typeof max === 'object') { this.max = max.max; this.current = max.current; }
		else { this.max = max; this.current = current; }
	}
	// add(value, mayOverflow) or add(ConstRange)
	add(value, mayOverflow) {
		if (value && typeof value === 'object') { this.max += value.max; this.current += value.current; return; }
		const before = this.current;
		this.current += value;
		if (!mayOverflow) this.capAtMax();
		return this.current !== before;
	}
	capAtMax() { if (this.current > this.max) { this.current = this.max; return true; } return false; }
	addToMax(value) { this.max += value; }
	subtract(value, mayUnderflow) {
		const before = this.current;
		this.current -= value;
		if (!mayUnderflow && this.current < 0) this.current = 0;
		return this.current !== before;
	}
	change(value, mayUnderflow, mayOverflow) {
		const before = this.current;
		if (value < 0) this.subtract(-value, mayUnderflow);
		else this.add(value, mayOverflow);
		return this.current !== before;
	}
	toString() { return Format.localizeInt(this.current) + '/' + Format.localizeInt(this.max); }
	toMinMaxString() {
		if (this.isMax()) return Format.localizeInt(this.max);
		return Format.localizeInt(this.current) + '-' + Format.localizeInt(this.max);
	}
	isMax() { return this.current >= this.max; }
	setMax() { this.current = this.max; }
	average() { return idiv(this.max + this.current, 2); }
	averagef() { return (this.max + this.current) / 2; }
	toJSON() { return [this.max, this.current]; }
	static fromJSON(a) { return new Range(a[0], a[1]); }
}

export class ConstRange {
	constructor(max, current) {
		if (max && typeof max === 'object') { this.max = max.max; this.current = max.current; }
		else { this.max = max; this.current = current; }
		Object.freeze(this);
	}
	toString() { return Format.localizeInt(this.current) + '/' + Format.localizeInt(this.max); }
	toMinMaxString() {
		if (this.isMax()) return Format.localizeInt(this.max);
		return Format.localizeInt(this.current) + '-' + Format.localizeInt(this.max);
	}
	toMinMaxAbsString() {
		if (this.isMax()) return Format.localizeInt(Math.abs(this.max));
		if (this.current < 0) return Format.localizeInt(Math.abs(this.max)) + '-' + Format.localizeInt(Math.abs(this.current));
		return Format.localizeInt(Math.abs(this.current)) + '-' + Format.localizeInt(Math.abs(this.max));
	}
	isMax() { return this.max === this.current; }
	average() { return idiv(this.max + this.current, 2); }
	averagef() { return (this.max + this.current) / 2; }
	toPercentString() { return Format.localizePercentCeil(this.current / this.max); }
	equals(r) { if (r == null) return false; return this.max === r.max && this.current === r.current; }
}

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const Format = {
	localizeInt(v) { return nf.format(v); },
	localizeIntNoSep(v) { return String(v); },
	localizePercentCeil(f) { return Math.ceil(f * 100) + '%'; },
	localizePercentFromIntPercent(p) { return Format.localizePercentCeil(p / 100.0); },
	localizeFloat(v, minD = 2, maxD = minD) {
		return new Intl.NumberFormat('en-US', { minimumFractionDigits: minD, maximumFractionDigits: maxD }).format(v);
	},
	localizeLongDigitSequences(s) {
		if (!s) return s;
		return s.replace(/\d{4,}/g, (d) => nf.format(Number(d)));
	},
};

// java.util.Random-ish helper. nextInt(n): uniform int in [0, n)
export const rnd = {
	nextInt(n) { return Math.floor(Math.random() * n); },
	nextFloat() { return Math.random(); },
	nextBoolean() { return Math.random() < 0.5; },
};

export const Constants = {
	PERCENT_EXP_LOST_WHEN_DIED: 20,
	LEVELUP_EFFECT_HEALTH: 5,
	LEVELUP_EFFECT_ATK_CH: 5,
	LEVELUP_EFFECT_ATK_DMG: 1,
	LEVELUP_EFFECT_DEF_CH: 3,
	FIRST_SKILL_POINT_IS_GIVEN_AT_LEVEL: 4,
	NEW_SKILL_POINT_EVERY_N_LEVELS: 4,
	MARKET_PRICEFACTOR_PERCENT: 15,
	MONSTER_AGGRESSION_CHANCE_PERCENT: 15,
	EXP_FACTOR_DAMAGERESISTANCE: 9,
	EXP_FACTOR_SCALING: 0.7,
	FLEE_FAIL_CHANCE_PERCENT: 20,
	MINIMUM_INPUT_INTERVAL: 200,
	MAX_MAP_WIDTH: 46,
	MAX_MAP_HEIGHT: 46,
	MONSTER_MOVEMENT_TURN_DURATION_MS: 1200,
	MONSTER_IMMOBILE_MOVE_COST: 999,
	TICK_DELAY: 500,
	TICKS_PER_ROUND: 6000 / 500,
	TICKS_PER_FULLROUND: 25000 / 500,
	SPLATTER_DURATION_MS: 20000,
	STATUS_TEXT_AUTOHIDE_DELAY: 6000,
	monsterWaitTurns: new ConstRange(5, 1),
	MAP_UNVISITED_RESPAWN_DURATION_MS: 3 * 60 * 1000,
	PLACEHOLDER_PLAYERNAME: '$playername',
	ITEMFILTER_ID_PREFIX: '#',
	PLACEHOLDER_REG1: '$reg1',
	PLACEHOLDER_REG2: '$reg2',
	PLACEHOLDER_REG3: '$reg3',
	PLACEHOLDER_NEXTPHRASEID: '$nextPhraseID',
	PASSIVE_ACHIEVEMENT_CHECK_PHRASE: 'passive_achievement_check',
	FACTION_SCORE_CALC_REGISTER1_NAME: 'reg1',
	FACTION_SCORE_CALC_REGISTER2_NAME: 'reg2',
	FACTION_SCORE_CALC_REGISTER3_NAME: 'reg3',

	// rollValue(ConstRange|Range r [, bias])
	rollValue(r, bias) {
		if (bias === undefined) return rollValueMM(r.max, r.current);
		return idiv(rollValueMM((r.max + 1) * 100 - 1, r.current * 100 + bias), 100);
	},
	roll100(chance) { return rollResultMV(100, chance); },
	rollResult(r, bias) {
		if (bias === undefined) return rollResultMV(r.max, r.current);
		return rollResultMV(r.max * 100, r.current * 100 + bias);
	},
};
function rollValueMM(max, min) {
	if (max <= min) return max;
	return rnd.nextInt(max - min + 1) + min;
}
function rollResultMV(probabilityMax, probabilityValue) {
	if (probabilityMax <= 0) return false; // Java would throw; be lenient
	return rnd.nextInt(probabilityMax) < probabilityValue;
}

// Simple listener list (port of util.ListOfListeners)
export class ListOfListeners {
	constructor() { this.listeners = []; }
	add(l) { if (!this.listeners.includes(l)) this.listeners.push(l); }
	remove(l) { const i = this.listeners.indexOf(l); if (i >= 0) this.listeners.splice(i, 1); }
	// call method name with args on every listener that implements it
	emit(method, ...args) {
		for (const l of [...this.listeners]) {
			if (typeof l[method] === 'function') l[method](...args);
		}
	}
}

export const L = {
	log(s) { console.log(s); },
	debug(s) { /* console.debug(s); */ },
	warn(s) { console.warn(s); },
};

// Helper for Java enum-like objects: Enum('a','b') -> {a:'a', b:'b', values:[...], ordinal(v)}
export function makeEnum(...names) {
	const e = {};
	names.forEach((n) => { e[n] = n; });
	Object.defineProperty(e, 'values', { value: names });
	Object.defineProperty(e, 'ordinal', { value: (n) => names.indexOf(n) });
	Object.defineProperty(e, 'valueOf', { value: (n) => { if (!names.includes(n)) throw new Error('No enum constant ' + n); return n; } });
	Object.defineProperty(e, 'fromString', { value: (s, def) => (s == null ? def : e.valueOf(s)) });
	return Object.freeze(e);
}

// Port of util/TimedMessageTask
export class TimedMessageTask {
	constructor(callback, interval, requireIntervalBeforeFirstTick) {
		this.interval = interval;
		this.requireIntervalBeforeFirstTick = requireIntervalBeforeFirstTick;
		this.callback = callback;
		this.nextTickTime = Date.now() + interval;
		this.hasQueuedTick = false;
		this.isAlive = false;
		this.handle = null;
	}
	_handleMessage() {
		this.handle = null;
		if (!this.isAlive) return;
		if (!this.hasQueuedTick) return;
		this.hasQueuedTick = false;
		this.tick();
	}
	tick() {
		this.nextTickTime = Date.now() + this.interval;
		let cont = false;
		try { cont = this.callback.onTick(this); } catch (e) { console.error(e); }
		if (cont) this.queueAnotherTick();
	}
	_sleep(ms) {
		if (this.handle) clearTimeout(this.handle);
		this.handle = setTimeout(() => this._handleMessage(), ms);
	}
	queueAnotherTick() {
		if (this.hasQueuedTick) return;
		this.hasQueuedTick = true;
		this._sleep(this.interval);
	}
	start() {
		this.isAlive = true;
		const tickNow = !this.requireIntervalBeforeFirstTick && !this.hasQueuedTick && Date.now() >= this.nextTickTime;
		if (tickNow) this.tick();
		else this.queueAnotherTick();
	}
	stop() {
		this.hasQueuedTick = false;
		this.isAlive = false;
	}
}
