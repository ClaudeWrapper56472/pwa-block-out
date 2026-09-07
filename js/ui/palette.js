/**
 * The block colours, and the two shades each block is drawn with.
 *
 * The stylesheet owns the chrome -- background, frame, buttons. What is here is
 * the part it cannot say: a block's colour comes from the level, so it is set
 * per element as custom properties and the tile rules derive from them.
 *
 * The lighter and darker shades are mixed here rather than with color-mix() so
 * the tiles paint the same everywhere, including on engines that would drop the
 * whole gradient over one unsupported function.
 */

const COLOURS = {
	r: "#e8534b",
	b: "#3f8ede",
	g: "#41ab63",
	y: "#e5b036",
	p: "#9a6ede",
	o: "#ef8a3c",
	t: "#2fb0aa",
	k: "#e076ad",
};

const FALLBACK = "#8b93a3";

export function blockColour(code) {
	return COLOURS[code] ?? FALLBACK;
}

/** Sets --block, --block-lit and --block-shade on an element. */
export function paintBlock(element, code) {
	const base = blockColour(code);
	element.style.setProperty("--block", base);
	element.style.setProperty("--block-lit", mix(base, "#ffffff", 0.26));
	element.style.setProperty("--block-shade", mix(base, "#000000", 0.22));
}

/** `amount` of 0 keeps `hex`, 1 returns `towards`. */
function mix(hex, towards, amount) {
	const from = parse(hex);
	const to = parse(towards);
	const channel = (index) => Math.round(from[index] + (to[index] - from[index]) * amount);
	return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`;
}

function parse(hex) {
	const value = Number.parseInt(hex.slice(1), 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
