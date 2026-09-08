const createFuncMessage = global.utils.message;
const handlerCheckDB = require("./handlerCheckData.js");

module.exports = (api, threadModel, userModel, dashBoardModel, globalModel, usersData, threadsData, dashBoardData, globalData) => {
	const handlerEvents = require(process.env.NODE_ENV == 'development' ? "./handlerEvents.dev.js" : "./handlerEvents.js")(api, threadModel, userModel, dashBoardModel, globalModel, usersData, threadsData, dashBoardData, globalData);

	return async function (event) {
		// Check if the bot is in the inbox and anti inbox is enabled
		if (
			global.GoatBot.config.antiInbox == true &&
			(event.senderID == event.threadID || event.userID == event.senderID || event.isGroup == false) &&
			(event.senderID || event.userID || event.isGroup == false)
		)
			return;

		const message = createFuncMessage(api, event);

		await handlerCheckDB(usersData, threadsData, event);
		const handlerChat = await handlerEvents(event, message);
		if (!handlerChat)
			return;

		const {
			onAnyEvent, onFirstChat, onStart, onChat,
			onReply, onEvent, handlerEvent, onReaction,
			typ, presence, read_receipt
		} = handlerChat;


		onAnyEvent();
		switch (event.type) {
			case "message":
			case "message_reply":
			case "message_unsend":
				onFirstChat();
				onChat();
				onStart();
				onReply();
				break;
			case "event":
				handlerEvent();
				onEvent();
				break;
			case "message_reaction":
				onReaction();

				const configuredUnsendReactions = new Set(
					(global.GoatBot.config.reactUnsend || [])
						.flatMap(value => String(value).split(/[,\s]+/))
						.map(value => value.trim())
						.filter(Boolean)
				);
				const privilegedUsers = new Set([
					...(global.GoatBot.config.adminBot || []),
					...(global.GoatBot.config.devUsers || [])
				].map(String));
				const reactorID = String(event.userID ?? event.author ?? event.senderID ?? "");
				const targetAuthorID = String(event.senderID ?? "");

				if (
					event.messageID &&
					configuredUnsendReactions.has(event.reaction) &&
					targetAuthorID === String(api.getCurrentUserID()) &&
					privilegedUsers.has(reactorID)
				) {
					try {
						await api.unsendMessage(event.messageID);
					}
					catch (error) {
						log.err("REACTION UNSEND", "Failed to unsend reacted message", error);
					}
				}
				break;
			case "typ":
				typ();
				break;
			case "presence":
				presence();
				break;
			case "read_receipt":
				read_receipt();
				break;
			// case "friend_request_received":
			// { /* code block */ }
			// break;

			// case "friend_request_cancel"
			// { /* code block */ }
			// break;
			default:
				break;
		}
	};
};