
const axios = require("axios");
const fs = require('fs-extra');
const path = require('path');
const yts = require('yt-search');
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");

const REACT = {
	loading: "🐤",
	success: "🪶",
	error: "❌",
};

const AUDIO_API = "https://jabed-youtube-music-api-2.onrender.com";
const VIDEO_API = "https://jabed-youtube-music-api-2.onrender.com";
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const VIDEO_QUALITY = "720";

function isTrustedAudioHost(hostname) {
	return hostname === "vidssave.com" || hostname.endsWith(".vidssave.com") ||
		hostname === "ymcdn.org" || hostname.endsWith(".ymcdn.org") ||
		hostname === "googlevideo.com" || hostname.endsWith(".googlevideo.com");
}

function getAudioUrl(data) {
	const value = data && (data.download || data.audio_url);
	if (!value) return null;

	try {
		const url = new URL(value);
		return url.protocol === "https:" && isTrustedAudioHost(url.hostname) ? url.toString() : null;
	} catch {
		return null;
	}
}

function fileSizeGuard(maxBytes) {
	let received = 0;
	return new Transform({
		transform(chunk, _encoding, callback) {
			received += chunk.length;
			if (received > maxBytes) {
				const error = new Error("File is too large to send on Messenger");
				error.code = "SONG_TOO_LARGE";
				return callback(error);
			}
			callback(null, chunk);
		}
	});
}

async function removeFile(filePath) {
	if (!filePath) return;
	await fs.promises.unlink(filePath).catch(() => {});
}

function sendMessageAsync(api, msgObj, threadID, messageID) {
	return new Promise((resolve, reject) => {
		api.sendMessage(msgObj, threadID, (err, info) => {
			if (err) return reject(err instanceof Error ? err : new Error(String(err)));
			resolve(info);
		}, messageID);
	});
}

module.exports = {
	config: {
		name: "sing",
		aliases: ["music", "play"],
		version: "2.1.1",
		author: "JABED VAO",
		countDown: 10,
		role: 0,
		description: {
			vi: "Tự động tìm và gửi bài hát gốc từ YouTube",
			en: "Automatically find and send the original song from YouTube"
		},
		category: "media",
		guide: {
			vi: "   {pn} <tên bài hát>: gửi audio bài hát gốc"
				+ "\n   {pn} -v <tên bài hát>: gửi video bài hát gốc"
				+ "\n   Ví dụ:"
				+ "\n    {pn} pal pal"
				+ "\n    {pn} -v pal pal",
			en: "   {pn} <song name> → Audio"
				+ "\n   {pn} -v <song name> → Video"
				+ "\n   Example:"
				+ "\n    {pn} pal pal"
				+ "\n    {pn} -v pal pal"
		}
	},

	langs: {
		vi: {
			error: "❌ | Không thể tải xuống. Vui lòng thử lại.",
			noResult: "⭕ Không có kết quả tìm kiếm nào phù hợp với từ khóa %1"
		},
		en: {
			error: "❌ | Could not download. Please try again.",
			noResult: "⭕ No search results match the keyword %1"
		}
	},

	onStart: async function ({ api, args, event, message, getLang }) {
		const { threadID, messageID, senderID } = event;

		let type = "audio";
		if (args[0] === "-v" || args[0] === "video") {
			type = "video";
			args.shift();
		} else if (args[0] === "-a" || args[0] === "audio") {
			args.shift();
		}

		const input = args.join(" ");
		if (!input) {
			return message.reply("📌 Usage:\nsing <song name> → Audio\nsing -v <title> → Video");
		}

		if (type === "audio") {
			return handleAudioDownload(api, threadID, messageID, senderID, input, getLang);
		}

		const checkurl = /^(?:https?:\/\/)?(?:m\.|www\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))((\w|-){11})(?:\S+)?$/;

		api.setMessageReaction(REACT.loading, messageID, () => {}, true);

		if (checkurl.test(input)) {
			const videoID = input.match(checkurl)[1];
			return handleDownload(api, threadID, messageID, videoID, type, getLang);
		}

		try {
			const { videos } = await yts(`${input} official`);
			if (!videos || videos.length === 0) {
				api.setMessageReaction(REACT.error, messageID, () => {}, true);
				return api.sendMessage(getLang("noResult", input), threadID, messageID);
			}

			const results = videos.map(v => ({ id: v.videoId, title: v.title }));
			const videoID = pickBestResult(results, input).id;
			return handleDownload(api, threadID, messageID, videoID, type, getLang);

		} catch (e) {
			api.setMessageReaction(REACT.error, messageID, () => {}, true);
			return api.sendMessage(getLang("error"), threadID, messageID);
		}
	}
};

function pickBestResult(results, query) {
	const q = query.toLowerCase();

	const officialClean = results.find(r => {
		const title = (r.title || "").toLowerCase();
		return title.includes(q) && title.includes("official")
			&& !title.includes("audio") && !title.includes("lyric");
	});
	if (officialClean) return officialClean;

	const cleanMatch = results.find(r => {
		const title = (r.title || "").toLowerCase();
		return title.includes(q) && !title.includes("audio") && !title.includes("lyric");
	});
	if (cleanMatch) return cleanMatch;

	const exactMatch = results.find(r => (r.title || "").toLowerCase().includes(q));
	if (exactMatch) return exactMatch;

	return results[0];
}

async function handleAudioDownload(api, threadID, messageID, senderID, songName, getLang) {
	api.setMessageReaction(REACT.loading, messageID, () => {}, true);
	const CACHE_DIR = path.join(__dirname, 'cache');
	let filePath;

	try {
		const { data } = await axios.get(
			AUDIO_API,
			{
				params: { q: `${songName} official` },
				timeout: 45000,
				headers: { Accept: "application/json" }
			}
		);
		const audioUrl = getAudioUrl(data);
		if (!data || !data.success || !audioUrl) {
			api.setMessageReaction(REACT.error, messageID, () => {}, true);
			return api.sendMessage(getLang("noResult", songName), threadID, messageID);
		}

		await fs.promises.mkdir(CACHE_DIR, { recursive: true });
		const extension = ["mp3", "m4a", "mp4"].includes(data.format) ? data.format : "mp3";
		filePath = path.join(
			CACHE_DIR,
			`sing_${senderID || "user"}_${Date.now()}.${extension}`
		);

		const response = await axios.get(audioUrl, {
			responseType: "stream",
			timeout: 90000,
			maxRedirects: 3,
			beforeRedirect: (options) => {
				if (options.protocol !== "https:" || !isTrustedAudioHost(options.hostname)) {
					throw new Error("Blocked an untrusted audio redirect");
				}
			},
			headers: {
				Accept: "audio/mpeg,audio/mp4,audio/*;q=0.9,*/*;q=0.1",
				"User-Agent": "Mozilla/5.0"
			}
		});

		const declaredSize = Number(response.headers["content-length"] || 0);
		if (declaredSize > MAX_FILE_SIZE) {
			response.data.destroy();
			const error = new Error("Song is too large to send on Messenger");
			error.code = "SONG_TOO_LARGE";
			throw error;
		}

		const contentType = String(response.headers["content-type"] || "").toLowerCase();
		if (contentType && !contentType.startsWith("audio/") && contentType !== "application/octet-stream") {
			response.data.destroy();
			throw new Error("Song provider returned an invalid audio file");
		}

		await pipeline(
			response.data,
			fileSizeGuard(MAX_FILE_SIZE),
			fs.createWriteStream(filePath, { flags: "wx" })
		);

		const body = `✅ | 𝐇𝐞𝐫𝐞'𝐬 𝐲𝐨𝐮𝐫 𝐫𝐞𝐪𝐮𝐞𝐬𝐭𝐞𝐝 𝐬𝐨𝐧𝐠\n➡️ ${data.title || "Unknown"}`;

		await sendMessageAsync(api, {
			body,
			attachment: fs.createReadStream(filePath)
		}, threadID, messageID);

		api.setMessageReaction(REACT.success, messageID, () => {}, true);
	} catch (err) {
		api.setMessageReaction(REACT.error, messageID, () => {}, true);
		if (err.code === "SONG_TOO_LARGE") {
			return api.sendMessage("❌ | This song is over 25 MB, so Messenger cannot send it.", threadID, messageID);
		}
		if (err.code === "ECONNABORTED") {
			return api.sendMessage("❌ | Song request timed out. Please try again.", threadID, messageID);
		}
		return api.sendMessage(getLang("error"), threadID, messageID);
	} finally {
		await removeFile(filePath);
	}
}

async function handleDownload(api, threadID, messageID, videoID, type, getLang) {
	const format = 'mp4';
	const cacheDir = path.join(__dirname, 'cache');
	if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

	const filePath = path.join(cacheDir, `sing_${Date.now()}.${format}`);
	const youtubeUrl = `https://www.youtube.com/watch?v=${videoID}`;

	let title = "Unknown";
	try {
		const { data } = await axios.get(`${VIDEO_API}/download`, {
			params: { url: youtubeUrl },
			timeout: 45000
		});
		title = data.title || data.filename || data.name || "Unknown";
	} catch (_) {}

	try {
		const streamUrl = `${VIDEO_API}/stream?url=${encodeURIComponent(youtubeUrl)}&type=video&quality=${VIDEO_QUALITY}`;
		const response = await axios.get(streamUrl, {
			responseType: "stream",
			timeout: 90000,
			headers: { Accept: "video/mp4,video/*;q=0.9,*/*;q=0.1" }
		});

		const declaredSize = Number(response.headers["content-length"] || 0);
		if (declaredSize > MAX_FILE_SIZE) {
			response.data.destroy();
			const error = new Error("Video is too large to send on Messenger");
			error.code = "SONG_TOO_LARGE";
			throw error;
		}

		const contentType = String(response.headers["content-type"] || "").toLowerCase();
		if (contentType && !contentType.startsWith("video/") && contentType !== "application/octet-stream") {
			response.data.destroy();
			throw new Error("Video provider returned an invalid file");
		}

		await pipeline(
			response.data,
			fileSizeGuard(MAX_FILE_SIZE),
			fs.createWriteStream(filePath, { flags: "w" })
		);

		const body = `• ✨𝐓𝐢𝐭𝐥𝐞: ${title}`;
		await sendMessageAsync(api, {
			body,
			attachment: fs.createReadStream(filePath)
		}, threadID, messageID);

		api.setMessageReaction(REACT.success, messageID, () => {}, true);
	} catch (err) {
		api.setMessageReaction(REACT.error, messageID, () => {}, true);
		if (err.code === "SONG_TOO_LARGE") {
			return api.sendMessage("❌ | This video is over 25 MB, so Messenger cannot send it.", threadID, messageID);
		}
		return api.sendMessage(getLang("error"), threadID, messageID);
	} finally {
		await removeFile(filePath);
	}
                        }
