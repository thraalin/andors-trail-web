// Android string resources (values/strings.xml) with java.util.Formatter-style formatting
import { Format } from './util.js';

let STR = {}, PLURALS = {}, ARRAYS = {};
export function initStrings(strings, plurals, arrays) { STR = strings || {}; PLURALS = plurals || {}; ARRAYS = arrays || {}; }

export function formatJava(fmt, args) {
	let auto = 0;
	return fmt.replace(/%(?:(\d+)\$)?([-#+ 0,(]*)?(\d+)?(?:\.(\d+))?([sdfx%n])/g, (m, idx, flags, width, prec, conv) => {
		if (conv === '%') return '%';
		if (conv === 'n') return '\n';
		const i = idx ? parseInt(idx, 10) - 1 : auto++;
		let v = args[i];
		if (v === undefined) return m;
		let s;
		switch (conv) {
			case 'd': s = (flags && flags.includes(',')) || Math.abs(v) >= 1000 ? Format.localizeInt(v) : String(Math.trunc(v)); break;
			case 'f': s = Number(v).toFixed(prec ? parseInt(prec, 10) : 6); break;
			case 'x': s = Number(v).toString(16); break;
			default: s = String(v);
		}
		if (flags && flags.includes('+') && conv !== 's' && Number(v) >= 0) s = '+' + s;
		if (width && s.length < parseInt(width, 10)) s = s.padStart(parseInt(width, 10), flags && flags.includes('0') ? '0' : ' ');
		return s;
	});
}

export function getString(name, ...args) {
	const s = STR[name];
	if (s == null) return name;
	return args.length ? formatJava(s, args) : s;
}
export function hasString(name) { return STR[name] != null; }
export function getQuantityString(name, quantity, ...args) {
	const p = PLURALS[name];
	if (!p) return getString(name, ...args);
	const s = (quantity === 1 && p.one) ? p.one : (p.other || p.one || '');
	return formatJava(s, args.length ? args : [quantity]);
}
export function getStringArray(name) { return ARRAYS[name] || []; }
