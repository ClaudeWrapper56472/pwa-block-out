/**
 * Draws the app icons.
 *
 *     node tools/make-icons.mjs
 *
 * The art is original and generated rather than drawn by hand, so the same
 * composition renders sharp at every size instead of being scaled from one
 * bitmap. Nothing is installed: shapes are rasterised into a byte array with
 * three-times supersampling and written out as PNG through node:zlib.
 *
 * The composition is the game in one frame -- a red block lined up with the red
 * gate it is about to leave by. Everything sits inside the middle 80% so the
 * maskable icon survives being cropped to a circle.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const SUPERSAMPLE = 3;

const BACKGROUND = "#171b23";
const FRAME = "#2f3745";
const WELL = "#12161d";
const CELL = "#212734";
const RED = "#e8534b";
const GREEN = "#41ab63";
const BLUE = "#3f8ede";
const ARROW = "#ffffff";

function render(size) {
	const scale = size * SUPERSAMPLE;
	const canvas = new Canvas(scale, scale);
	const unit = scale / 1024;
	const at = (value) => value * unit;

	canvas.fill(BACKGROUND);

	// Board: a frame ring with the well cut out of it.
	canvas.roundRect(at(140), at(140), at(744), at(744), at(120), FRAME);
	canvas.roundRect(at(196), at(196), at(632), at(632), at(72), WELL);

	const cell = 158;
	const origin = 196;
	const box = (row, col, rows, cols) => ({
		x: at(origin + col * cell + 10),
		y: at(origin + row * cell + 10),
		w: at(cols * cell - 20),
		h: at(rows * cell - 20),
	});
	const centre = (row, col) => ({
		x: at(origin + (col + 0.5) * cell),
		y: at(origin + (row + 0.5) * cell),
	});

	for (let row = 0; row < 4; row += 1) {
		for (let col = 0; col < 4; col += 1) {
			const spot = box(row, col, 1, 1);
			canvas.roundRect(spot.x, spot.y, spot.w, spot.h, at(30), CELL);
		}
	}

	// The gates the blocks are pointed at.
	canvas.roundRect(at(828), at(196), at(56), at(158), at(22), RED);
	canvas.roundRect(at(354), at(140), at(158), at(56), at(22), GREEN);

	const red = box(0, 0, 1, 2);
	canvas.roundRect(red.x, red.y, red.w, red.h, at(34), RED);
	canvas.arrow(centre(0, 1), at(cell * 0.44), 1, ARROW);

	const green = box(2, 1, 2, 1);
	canvas.roundRect(green.x, green.y, green.w, green.h, at(34), GREEN);
	canvas.arrow(centre(2, 1), at(cell * 0.44), 0, ARROW);

	const blue = box(2, 3, 1, 1);
	canvas.roundRect(blue.x, blue.y, blue.w, blue.h, at(34), BLUE);
	canvas.arrow(centre(2, 3), at(cell * 0.44), 2, ARROW);

	return encode(canvas.downsample(SUPERSAMPLE), size, size);
}

/** A plain RGB byte grid with the few shapes this icon needs. */
class Canvas {
	constructor(width, height) {
		this.width = width;
		this.height = height;
		this.pixels = new Uint8Array(width * height * 3);
	}

	fill(colour) {
		const [r, g, b] = parse(colour);
		for (let index = 0; index < this.pixels.length; index += 3) {
			this.pixels[index] = r;
			this.pixels[index + 1] = g;
			this.pixels[index + 2] = b;
		}
	}

	paint(x, y, colour) {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
		const index = (y * this.width + x) * 3;
		this.pixels[index] = colour[0];
		this.pixels[index + 1] = colour[1];
		this.pixels[index + 2] = colour[2];
	}

	roundRect(x, y, width, height, radius, colour) {
		const rgb = parse(colour);
		const right = x + width;
		const bottom = y + height;
		for (let py = Math.floor(y); py < Math.ceil(bottom); py += 1) {
			for (let px = Math.floor(x); px < Math.ceil(right); px += 1) {
				const cx = px + 0.5;
				const cy = py + 0.5;
				if (cx < x || cx > right || cy < y || cy > bottom) continue;
				const dx = Math.max(x + radius - cx, cx - (right - radius), 0);
				const dy = Math.max(y + radius - cy, cy - (bottom - radius), 0);
				if (dx * dx + dy * dy > radius * radius) continue;
				this.paint(px, py, rgb);
			}
		}
	}

	/** A block arrow, `turns` quarter-turns clockwise from pointing up. */
	arrow(centre, size, turns, colour) {
		const shape = [
			[0, -0.5], [0.42, 0.04], [0.17, 0.04], [0.17, 0.5],
			[-0.17, 0.5], [-0.17, 0.04], [-0.42, 0.04],
		];
		const angle = (turns * Math.PI) / 2;
		const points = shape.map(([x, y]) => [
			centre.x + (x * Math.cos(angle) - y * Math.sin(angle)) * size,
			centre.y + (x * Math.sin(angle) + y * Math.cos(angle)) * size,
		]);
		const rgb = parse(colour);
		const left = Math.floor(Math.min(...points.map((point) => point[0])));
		const right = Math.ceil(Math.max(...points.map((point) => point[0])));
		const top = Math.floor(Math.min(...points.map((point) => point[1])));
		const bottom = Math.ceil(Math.max(...points.map((point) => point[1])));
		for (let py = top; py <= bottom; py += 1) {
			for (let px = left; px <= right; px += 1) {
				if (inside(points, px + 0.5, py + 0.5)) this.paint(px, py, rgb);
			}
		}
	}

	/** Box filter down to the finished size, which is where the edges soften. */
	downsample(factor) {
		const width = this.width / factor;
		const height = this.height / factor;
		const out = new Uint8Array(width * height * 4);
		const area = factor * factor;
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				let r = 0;
				let g = 0;
				let b = 0;
				for (let sy = 0; sy < factor; sy += 1) {
					for (let sx = 0; sx < factor; sx += 1) {
						const index = ((y * factor + sy) * this.width + x * factor + sx) * 3;
						r += this.pixels[index];
						g += this.pixels[index + 1];
						b += this.pixels[index + 2];
					}
				}
				const target = (y * width + x) * 4;
				out[target] = Math.round(r / area);
				out[target + 1] = Math.round(g / area);
				out[target + 2] = Math.round(b / area);
				out[target + 3] = 255;
			}
		}
		return out;
	}
}

function inside(points, x, y) {
	let hit = false;
	for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
		const [xi, yi] = points[i];
		const [xj, yj] = points[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
	}
	return hit;
}

function parse(hex) {
	const value = Number.parseInt(hex.slice(1), 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Minimal PNG writer: one IHDR, one IDAT of filter-zero rows, one IEND. */
function encode(rgba, width, height) {
	const raw = Buffer.alloc(height * (width * 4 + 1));
	for (let y = 0; y < height; y += 1) {
		const row = y * (width * 4 + 1);
		raw[row] = 0;
		Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, row + 1);
	}

	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bit depth
	header[9] = 6; // colour type: RGBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

function chunk(type, body) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(body.length, 0);
	const payload = Buffer.concat([Buffer.from(type, "ascii"), body]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(payload), 0);
	return Buffer.concat([length, payload, crc]);
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let code = n;
		for (let k = 0; k < 8; k += 1) {
			code = code & 1 ? 0xedb88320 ^ (code >>> 1) : code >>> 1;
		}
		table[n] = code >>> 0;
	}
	return table;
})();

function crc32(buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

for (const size of [192, 512, 1024]) {
	writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), render(size));
	process.stdout.write(`icons/icon-${size}.png\n`);
}
