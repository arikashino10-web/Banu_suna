const axios = require("axios");

const mahmud = async () => {
	const base = await axios.get("https://raw.githubusercontent.com/mahmudx7/HINATA/main/baseApiUrl.json");
	return base.data.mahmud;
};

module.exports = {
	config: {
		name: "music",
		version: "1.7",
		author: "乛 SIYAM ゎ",
		countDown: 10,
		role: 0,
		description: {
			en: "Search and download any song as an audio file"
		},
		category: "music",
		guide: {
			en: '   {pn} <song name>: Enter song name to download'
		}
	},

	langs: {
		en: {
			noInput: "× Baby, please provide a song name! 🎵\nExample: {pn} shape of you",
			success: "✅ | Here's your requested song baby <\n• 𝐒𝐨𝐧𝐠: %1",
			error: "× API error: %1. ."
		}
	},

	onStart: async function ({ api, event, args, message, getLang }) {
		const query = args.join(" ");
		if (!query) return message.reply(getLang("noInput"));

		try {
			api.setMessageReaction("⌛", event.messageID, () => {}, true);

			const baseUrl = await mahmud();
			const apiUrl = `${baseUrl}/api/song/mahmud?query=${encodeURIComponent(query)}`;

			const response = await axios({
				method: "GET",
				url: apiUrl,
				responseType: "stream"
			});

			return message.reply({
				body: getLang("success", query),
				attachment: response.data
			}, () => {
				api.setMessageReaction("🪽", event.messageID, () => {}, true);
			});

		} catch (err) {
			console.error("music error:", err);
			api.setMessageReaction("❌", event.messageID, () => {}, true);
			return message.reply(getLang("error", err.message));
		}
	}
};

