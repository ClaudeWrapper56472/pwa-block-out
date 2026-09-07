/**
 * The hand-authored levels, in order.
 *
 * See level.js for the picture format. In short: the outer ring is the board
 * edge, a colour letter there is a gate; inside, a capital letter is a block
 * cell, `#` is a wall and a dot is empty. The `blocks` table gives each id a
 * colour code and a facing.
 *
 * `par` is the fewest taps that clear the board. tests/verify.mjs solves every
 * level and fails if a declared par is wrong, so these numbers cannot drift.
 *
 * Colour codes: r red, b blue, g green, y yellow, p purple, o orange, t teal,
 * k pink.
 */
export const LEVEL_SPECS = [
	{
		name: "First steps",
		par: 3,
		blocks: { A: "r>", B: "bv", C: "g^" },
		art: [
			"....g.",
			".AA..r",
			"..B.C.",
			"....C.",
			"..b...",
		],
	},
	{
		name: "Wait your turn",
		par: 3,
		blocks: { A: "r<", B: "b^", C: "g>" },
		art: [
			"...b..",
			"r.AA..",
			"...B..",
			"...B..",
			"....Cg",
			"......",
		],
	},
	{
		name: "Knot",
		par: 4,
		blocks: { A: "gv", B: "r<", C: "y>", D: "bv" },
		art: [
			".......",
			"..AA...",
			"r.B....",
			"r.B....",
			"...CC.y",
			".....D.",
			"..gg.b.",
		],
	},
	{
		name: "Wide load",
		par: 4,
		blocks: { A: "ov", B: "b<", C: "y^", D: "g>" },
		art: [
			"......y.",
			"..AA....",
			"..AA....",
			"bB......",
			"..DDD.Cg",
			"..oo....",
		],
	},
	{
		name: "Four ways",
		par: 5,
		blocks: { A: "r>", B: "b^", C: "gv", D: "y>", E: "p^" },
		art: [
			"....bp.",
			".AA.B.r",
			"....B..",
			".C...E.",
			".C.DDEy",
			".g.....",
		],
	},
	{
		name: "Chain",
		par: 5,
		blocks: { A: "r>", B: "b^", C: "g>", D: "y^", E: "p>" },
		art: [
			"..y.b..",
			"..AAA.r",
			".CC.B.g",
			".......",
			"..D....",
			".....Ep",
			".......",
		],
	},
	{
		name: "Elbow",
		par: 5,
		blocks: { B: "bv", C: "g<", D: "y^", E: "r>", L: "p>" },
		art: [
			"..y.....",
			".L....Bp",
			".LL...Bp",
			"........",
			"..D.....",
			"g.D.CC..",
			".....EEr",
			"......b.",
		],
	},
	{
		name: "Crossroads",
		par: 6,
		blocks: { A: "r>", B: "b^", C: "g>", D: "y^", E: "pv", F: "tv" },
		art: [
			".....by.",
			".AA..B.r",
			".....B..",
			".C....Dg",
			".C.EE.Dg",
			".....F..",
			"...ppt..",
		],
	},
	{
		name: "Corner office",
		par: 6,
		blocks: { A: "r>", B: "g>", C: "y^", D: "b>", E: "pv", F: "tv" },
		art: [
			"......y.",
			"...AA..r",
			".B....Cg",
			"...##.C.",
			".DD...Eb",
			"...FF.E.",
			"...tt.p.",
		],
	},
	{
		name: "Shunt",
		par: 5,
		blocks: { W: "y<", X: "b>", Y: "g^", Z: "rv" },
		art: [
			".g....",
			".XX.Zb",
			".Y..Z.",
			"yY.WW.",
			"......",
			"....r.",
		],
	},
	{
		name: "Pinwheel",
		par: 7,
		blocks: { U: "ov", V: "k^", W: "y<", X: "b>", Y: "g^", Z: "rv" },
		art: [
			".g...k.",
			".XX.Z.b",
			".Y..Z..",
			"yY.WW..",
			".....V.",
			"..UU.V.",
			"..oor..",
		],
	},
	{
		name: "Nest",
		par: 7,
		blocks: { B: "y<", H: "b>", L: "g^", Q: "k>", S: "o<", V: "rv" },
		art: [
			"..g.....",
			"o.S.....",
			"..HH.V.b",
			"..L..V..",
			"y.L.BB..",
			".....QQk",
			".....QQk",
			".....r..",
		],
	},
	{
		name: "Warehouse",
		par: 7,
		blocks: { A: "r>", B: "bv", C: "y>", D: "pv", E: "g^", F: "t<" },
		art: [
			".gg......",
			"...AA..Br",
			".......B.",
			".C......y",
			".C...DD.y",
			"...##....",
			"tEE...FF.",
			".....ppb.",
		],
	},
	{
		name: "Traffic",
		par: 8,
		blocks: { A: "b>", B: "rv", C: "g^", D: "y<", E: "ov", F: "tv", G: "k>" },
		art: [
			".g......",
			".AA.B.Eb",
			".C..B.E.",
			"yC.DD...",
			"........",
			".FFF....",
			"....GG.k",
			".tttr.o.",
		],
	},
	{
		name: "Look first",
		par: 8,
		blocks: { M: "p^", N: "tv", P: "ov", W: "y<", X: "b>", Y: "g^", Z: "rv" },
		art: [
			".g..p...",
			".XX...Zb",
			"yY..MWW.",
			".Y......",
			"........",
			".NN.PP..",
			".tt.oor.",
		],
	},
	{
		name: "Slipstream",
		par: 8,
		blocks: { L: "p>", N: "tv", P: "o>", Q: "b^", W: "y<", Y: "g^", Z: "rv" },
		art: [
			".g...b..",
			".LL...Zp",
			".YL...Zp",
			"yY...QW.",
			"........",
			".NNN....",
			".....P.o",
			".....P.o",
			".ttt..r.",
		],
	},
	{
		name: "Two rings",
		par: 10,
		blocks: { A: "b>", B: "rv", C: "g^", D: "y<", H: "p<", R: "o^", T: "t>", V: "kv" },
		art: [
			".g....o.",
			".AA.B..b",
			".C..B...",
			"yC.DD...",
			"p..V.HH.",
			"...V..R.",
			"...TT.Rt",
			"...kr...",
		],
	},
	{
		name: "Interchange",
		par: 11,
		blocks: { A: "b>", H: "o>", M: "bv", R: "tv", T: "k<", V: "p^", W: "y<", Y: "g^", Z: "rv" },
		art: [
			".g...p...",
			".AA.Z.M.b",
			".Y..Z....",
			"yY.WW....",
			".....H.Ro",
			".....V.R.",
			"k....VTT.",
			"....r.bt.",
		],
	},
	{
		name: "Standstill",
		par: 13,
		blocks: { A: "b>", H: "o<", K: "g<", M: "bv", R: "tv", S: "bv", T: "k>", V: "p^", W: "y<", Y: "g^", Z: "rv" },
		art: [
			".g.....p.",
			".AA.Z.S.b",
			".Y..Z....",
			"yY.WW....",
			".MM......",
			"o....R.H.",
			"g.K..R.V.",
			"g.K..TTVk",
			".bb.rtb..",
		],
	},
	{
		name: "Last exit",
		par: 15,
		blocks: { A: "b<", G: "y<", H: "o>", K: "g>", M: "bv", N: "o^", R: "tv", S: "bv", T: "k<", V: "p^", W: "y>", Y: "g^", Z: "rv" },
		art: [
			".p...oog.",
			"b.S.Z.AA.",
			"....ZNNY.",
			"....WW.Yy",
			"y.GG..MM.",
			".H.R....o",
			".V.R..K.g",
			"kVTT..K.g",
			".bbtr.bb.",
		],
	},
];

/**
 * The entry points the menu offers, in order, as the level each one starts on.
 *
 * Three places to join the one ladder, not three settings. Each opens on the
 * level that introduces its band's idea, which is also the gentlest level in
 * the band: Medium on the first shunt, Hard on the first board that can be
 * lost. tests/verify.mjs holds these to the levels they name.
 */
export const DIFFICULTIES = [
	{ name: "Easy", from: 1 },
	{ name: "Medium", from: 10 },
	{ name: "Hard", from: 15 },
];
