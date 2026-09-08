module.exports = {
	config: {
		name: "unsend",
		aliases: ["u","r","uns"],
		version: "1.2",
		author: "NTKhang",
		countDown: 5,
		role: 0,
		description: {
			vi: "Gỡ tin nhắn của bot",
			en: "Unsend bot's message"
		},
		category: "box chat",
		guide: {
			vi: "reply tin nhắn muốn gỡ của bot và gọi lệnh {pn}",
			en: "reply the message you want to unsend and call the command {pn}"
		}
	},

	langs: {
		vi: {
			syntaxError: "Vui lòng reply tin nhắn muốn gỡ của bot"
		},
		en: {
			syntaxError: "Please reply the message you want to unsend"
		}
	},

	onStart: async function ({ message, event, api, getLang }) {
		if (!event.messageReply || String(event.messageReply.senderID) !== String(api.getCurrentUserID()))
			return message.reply(getLang("syntaxError"));

		try {
			await api.unsendMessage(event.messageReply.messageID);
		}
		catch (error) {
			return message.reply("✖ Unable to unsend that message: " + (error.message || "unknown error"));
		}
	}
};
