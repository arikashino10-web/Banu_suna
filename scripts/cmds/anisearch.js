const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { execFile } = require("child_process");

// ফলব্যাক সার্চের জন্য (package.json এ আগে থেকেই আছে)
let yts = null;
try { yts = require("yt-search"); } catch (_) { }

/* ══════════════════════════════════════════════════════════════
   ⚙️ সেটিংস
   ══════════════════════════════════════════════════════════════ */
// তোমার YouTube Music API (Render এ চলছে)। Railway Variables এ MUSIC_API দিয়ে বদলানো যায়
const API_BASE = (process.env.MUSIC_API || "https://jabed-youtube-music-api-2.onrender.com").replace(/\/+$/, "");

const MAX_FILE_SIZE = 25 * 1024 * 1024;   // Messenger এ পাঠানোর সীমা ~২৫MB
const PREFER_SECONDS = 5 * 60;            // এডিট সাধারণত ছোট হয়, তাই ৫ মিনিটের মধ্যেগুলো আগে
const API_TIMEOUT = 120000;               // Render ঘুমিয়ে থাকলে জাগতে সময় লাগে
const DOWNLOAD_TIMEOUT = 180000;          // একটা ভিডিও নামানোর সর্বোচ্চ সময়
const MAX_TRIES = 3;                      // একটা ফেল করলে পরের ভিডিও (সর্বোচ্চ কয়টা)
const MEMORY_LIMIT = 500;                 // কতগুলো দেখা ভিডিও মনে রাখবে
const CACHE_DIR = path.join(__dirname, "cache");

// দেখা ভিডিও মনে রাখা, যাতে একই ভিডিও বারবার না আসে
if (!global.instaMemory) global.instaMemory = new Set();

const TUTORIAL_KEYWORDS = [
	"tutorial", "how to edit", "how to make", "how i edit", "how to create",
	"cara edit", "cara buat", "cara membuat", "edit tutorial", "editing tutorial",
	"step by step", "tuto edit", "tuto ", "learn how", "edit guide",
	"guide to edit", "capcut tutorial", "alight motion tutorial",
	"kaise edit", "edit kaise", "edit karna", "editing kaise", "coba edit",
	"belajar edit", "trik edit", "tips edit", "preset tutorial"
];

function isTutorialVideo(video) {
	const text = `${video.title || ""} ${video.desc || ""} ${video.description || ""}`.toLowerCase();
	return TUTORIAL_KEYWORDS.some(kw => text.includes(kw));
}

/* ══════════════════════════════════════════════════════════════
   🔧 সাহায্যকারী ফাংশন
   ══════════════════════════════════════════════════════════════ */
function toSeconds(d) {
	if (d == null || d === "") return 0;
	if (typeof d === "object") return toSeconds(d.seconds ?? d.timestamp ?? d.text);
	if (typeof d === "number") return d > 100000 ? Math.round(d / 1000) : d; // মিলিসেকেন্ড হলে সেকেন্ডে
	const s = String(d).trim();
	if (/^\d+$/.test(s)) return toSeconds(Number(s));
	if (/^\d+(:\d+){1,2}$/.test(s)) return s.split(":").map(Number).reduce((a, x) => a * 60 + x, 0);
	const iso = s.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
	if (iso && (iso[1] || iso[2] || iso[3])) {
		return Number(iso[1] || 0) * 3600 + Number(iso[2] || 0) * 60 + Math.round(Number(iso[3] || 0));
	}
	return 0;
}

function idFromUrl(u) {
	const m = String(u || "").match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})/);
	return m ? m[1] : null;
}

// API এর উত্তরের ধরন যেমনই হোক, তালিকা বের করে আনা
function extractItems(data) {
	let arr = Array.isArray(data)
		? data
		: (data && (data.results || data.items || data.videos || data.data || data.result || data.songs)) || [];
	if (!Array.isArray(arr)) arr = [];
	return arr
		.map(x => {
			if (!x || typeof x !== "object") return null;
			const id = x.id || x.videoId || x.video_id || idFromUrl(x.url || x.link || x.webpage_url);
			const authorRaw = x.author || x.channel || x.uploader || x.artist || "";
			const rawDur = x.seconds ?? x.duration ?? x.lengthSeconds ?? x.duration_seconds ??
				x.durationSeconds ?? x.duration_string ?? x.timestamp ?? x.durationMs ?? x.duration_ms;
			return {
				id,
				title: x.title || x.name || "",
				description: x.description || x.desc || "",
				author: typeof authorRaw === "object" ? (authorRaw.name || "") : String(authorRaw),
				seconds: toSeconds(rawDur)
			};
		})
		.filter(x => x && x.id && /^[\w-]{11}$/.test(String(x.id)));
}

async function apiSearch(query) {
	const res = await axios.get(`${API_BASE}/api/search`, {
		params: { q: query },
		timeout: API_TIMEOUT,
		validateStatus: () => true
	});
	return extractItems(res.data);
}

// API তে না পেলে সরাসরি YouTube সার্চ (ভিডিও পরে API দিয়েই আসবে)
async function fallbackSearch(query) {
	if (!yts) return [];
	const r = await yts(query);
	return (r.videos || [])
		.filter(v => v && v.videoId)
		.map(v => ({
			id: v.videoId,
			title: v.title || "",
			description: v.description || "",
			author: (v.author && v.author.name) || "",
			seconds: Number(v.seconds) || toSeconds(v.timestamp)
		}));
}

async function searchAny(term) {
	let items = [];
	try { items = await apiSearch(term); } catch (err) {
		console.error("[anisr] API সার্চ ফেল:", err && err.message);
	}
	if (!items.length) {
		try { items = await fallbackSearch(term); } catch (err) {
			console.error("[anisr] ফলব্যাক সার্চ ফেল:", err && err.message);
		}
	}
	return items;
}

function tooLargeError() {
	const e = new Error("ভিডিও ২৫MB এর বেশি বড়, Messenger এ পাঠানো যায় না");
	e.code = "TOO_LARGE";
	return e;
}

function fileSizeGuard(maxBytes) {
	let received = 0;
	return new Transform({
		transform(chunk, _enc, cb) {
			received += chunk.length;
			if (received > maxBytes) return cb(tooLargeError());
			cb(null, chunk);
		}
	});
}

function readStreamText(stream, limit) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		stream.on("data", c => {
			size += c.length;
			if (size <= limit) chunks.push(c);
		});
		stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		stream.on("error", reject);
	});
}

function videoExt(ct) {
	const t = String(ct || "").toLowerCase();
	if (t.includes("webm")) return "webm";
	if (t.includes("matroska") || t.includes("mkv")) return "mkv";
	return "mp4";
}

// স্ট্রিম থেকে ফাইলে সেভ করা (আকারের সীমা সহ)
async function saveStream(res, base) {
	const declared = Number(res.headers["content-length"] || 0);
	if (declared > MAX_FILE_SIZE) {
		res.data.destroy();
		throw tooLargeError();
	}
	const file = `${base}.${videoExt(res.headers["content-type"])}`;
	await pipeline(res.data, fileSizeGuard(MAX_FILE_SIZE), fs.createWriteStream(file));
	if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error("API থেকে খালি ফাইল এসেছে");
	return file;
}

// API থেকে ভিডিও নামিয়ে base নামে সেভ করে, ফাইলের পথ ফেরত দেয়
async function downloadVideo(videoId, base) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT);
	try {
		const res = await axios.get(`${API_BASE}/api/stream`, {
			params: { v: videoId, type: "video" },
			responseType: "stream",
			timeout: API_TIMEOUT,
			signal: ctrl.signal,
			validateStatus: () => true,
			headers: { Accept: "*/*" }
		});

		const ct = String(res.headers["content-type"] || "");

		// এরর বা ডাউনলোড লিংক (JSON/লেখা) এলে
		if (res.status >= 400 || /json|text|html/i.test(ct)) {
			const text = await readStreamText(res.data, 200000);
			let j = null;
			try { j = JSON.parse(text); } catch (_) { }
			const link = res.status < 400 && j &&
				(j.url || j.videoUrl || j.downloadUrl || j.download_url || j.link);
			if (typeof link === "string" && /^https:\/\//i.test(link)) {
				const r2 = await axios.get(link, {
					responseType: "stream",
					timeout: API_TIMEOUT,
					signal: ctrl.signal,
					maxRedirects: 3,
					headers: { "User-Agent": "Mozilla/5.0" }
				});
				return await saveStream(r2, base);
			}
			const msg = (j && (j.error || j.message)) || text.replace(/\s+/g, " ").slice(0, 150) || `HTTP ${res.status}`;
			throw new Error(`API: ${msg}`);
		}

		return await saveStream(res, base);
	} finally {
		clearTimeout(timer);
	}
}

// ffmpeg দিয়ে mp4 বানানো। সফল হলে true (ffmpeg না থাকলে false)
function toMp4(input, output) {
	return new Promise(resolve => {
		execFile(
			"ffmpeg",
			["-y", "-i", input, "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", output],
			{ timeout: 150000 },
			err => resolve(!err && fs.existsSync(output) && fs.statSync(output).size > 0)
		);
	});
}

function cleanup(base) {
	try {
		const prefix = path.basename(base);
		for (const f of fs.readdirSync(CACHE_DIR)) {
			if (f.startsWith(prefix)) fs.unlink(path.join(CACHE_DIR, f), () => { });
		}
	} catch (_) { }
}

// ফাইল পাঠানোর স্ট্রিমে এরর এলে (যেমন ফাইল আগে মুছে গেলে) বট যেন ক্র্যাশ না করে
function safeStream(file) {
	const s = fs.createReadStream(file);
	s.on("error", () => { });
	return s;
}

function react(api, emoji, messageID) {
	try { api.setMessageReaction(emoji, messageID, () => { }, true); } catch (_) { }
}

function serifBold(text) {
	const letters = {
		'a': '𝐚', 'b': '𝐛', 'c': '𝐜', 'd': '𝐝', 'e': '𝐞', 'f': '𝐟', 'g': '𝐠', 'h': '𝐡', 'i': '𝐢', 'j': '𝐣', 'k': '𝐤', 'l': '𝐥', 'm': '𝐦',
		'n': '𝐧', 'o': '𝐨', 'p': '𝐩', 'q': '𝐪', 'r': '𝐫', 's': '𝐬', 't': '𝐭', 'u': '𝐮', 'v': '𝐯', 'w': '𝐰', 'x': '𝐱', 'y': '𝐲', 'z': '𝐳',
		'A': '𝐀', 'B': '𝐁', 'C': '𝐂', 'D': '𝐃', 'E': '𝐄', 'F': '𝐅', 'G': '𝐆', 'H': '𝐇', 'I': '𝐈', 'J': '𝐉', 'K': '𝐊', 'L': '𝐋', 'M': '𝐌',
		'N': '𝐍', 'O': '𝐎', 'P': '𝐏', 'Q': '𝐐', 'R': '𝐑', 'S': '𝐒', 'T': '𝐓', 'U': '𝐔', 'V': '𝐕', 'W': '𝐖', 'X': '𝐗', 'Y': '𝐘', 'Z': '𝐙',
		'0': '𝟎', '1': '𝟏', '2': '𝟐', '3': '𝟑', '4': '𝟒', '5': '𝟓', '6': '𝟔', '7': '𝟕', '8': '𝟖', '9': '𝟗'
	};
	return Array.from(String(text)).map(char => letters[char] || char).join("");
}

/* ══════════════════════════════════════════════════════════════
   🚀 COMMAND
   ══════════════════════════════════════════════════════════════ */
module.exports = {
	config: {
		name: "anisearch",
		aliases: ["anisr"],
		version: "2.1.0",
		author: "JABED VAO",
		countDown: 5,
		role: 0,
		description: "Anime edits from YouTube",
		category: "media",
		guide: {
			en: "{pn} [anime name]"
		}
	},

	onStart: async function ({ api, event, args, message }) {
		const { messageID, senderID } = event;

		const query = args.join(" ").trim();
		if (!query) return message.reply(serifBold("Please provide an anime name! 🌸"));

		react(api, "✨", messageID);
		fs.ensureDirSync(CACHE_DIR);

		try {
			/* ─── সার্চ: এডিট খোঁজা, কম পেলে আরেকবার ─── */
			let items = await searchAny(`${query} anime edit amv`);
			let usable = items.filter(v => !isTutorialVideo(v));
			if (usable.length < 3) {
				const more = await searchAny(`${query} amv edit`);
				const have = new Set(items.map(v => v.id));
				items = items.concat(more.filter(v => !have.has(v.id)));
				usable = items.filter(v => !isTutorialVideo(v));
			}

			if (!usable.length) {
				react(api, "❌", messageID);
				return message.reply(serifBold(`No anime edit found for "${query}". Try another name!`));
			}

			// ছোট ভিডিও (এডিট) আগে, তারপর বাকিগুলো
			const preferred = usable.filter(v => v.seconds > 0 && v.seconds <= PREFER_SECONDS);
			const others = usable.filter(v => !preferred.includes(v));
			const pool = preferred.concat(others);

			// যেগুলো আগে পাঠানো হয়নি সেগুলো আগে; সব পাঠানো হয়ে গেলে মেমোরি পরিষ্কার
			let fresh = pool.filter(v => !global.instaMemory.has(v.id));
			if (!fresh.length) {
				global.instaMemory.clear();
				fresh = pool;
			}

			// নতুনগুলো সব ফেল করলে শেষ ভরসা হিসেবে আগে পাঠানো একটা (এরর দেখানোর চেয়ে ভালো)
			const seen = pool.filter(v => !fresh.includes(v));
			const order = fresh.slice(0, MAX_TRIES).concat(seen.slice(0, 1));

			let lastErr = null;
			for (const video of order) {
				const base = path.join(CACHE_DIR, `anisr_${senderID || "user"}_${Date.now()}`);
				try {
					let file = await downloadVideo(video.id, base);

					if (!file.endsWith(".mp4")) {
						const out = `${base}_c.mp4`;
						if (await toMp4(file, out)) file = out;
					}
					if (fs.statSync(file).size > MAX_FILE_SIZE) throw tooLargeError();

					await message.reply({
						body: serifBold("• Here is your video baby  <😘"),
						attachment: safeStream(file)
					});

					if (global.instaMemory.size >= MEMORY_LIMIT) global.instaMemory.clear();
					global.instaMemory.add(video.id);
					console.log(`[anisr] সোর্স: API "${video.title}"`);
					react(api, "🌸", messageID);
					cleanup(base);
					return;
				} catch (err) {
					lastErr = err;
					console.error(`[anisr] "${video.title || video.id}" ফেল:`, err && err.message);
					cleanup(base);
				}
			}

			throw lastErr || new Error("unknown");
		} catch (err) {
			console.error("[anisr] ত্রুটি:", err && err.message);
			react(api, "⚠️", messageID);

			const timedOut = err && (err.code === "ECONNABORTED" || err.code === "ERR_CANCELED");
			const reason = timedOut
				? "Connection timed out. Try again!"
				: `Could not get the video (${String((err && err.message) || "unknown").slice(0, 120)}). Try again!`;
			return message.reply(serifBold(`⚠️ | ${reason}`));
		}
	}
};
         
