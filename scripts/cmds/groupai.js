/**
 * Owner-only GroupAI/GCAI command.
 * The implementation lives in groupai-core.js so it can be tested without
 * booting Facebook or the complete GoatBot runtime.
 */

const core = require("./groupai-core");

function isCommandBody(body) {
  return /^\s*\.(?:gcai|groupai)(?:\s|$)/i.test(String(body || ""));
}

module.exports = {
  config: {
    name: "gcai",
    aliases: ["groupai"],
    version: "4.0.0",
    author: "System",
    countDown: 3,
    role: 0,
    shortDescription: {
      bn: "👑 Owner-only AI assistant",
      en: "👑 Owner-only AI assistant"
    },
    category: "AI/Development",
    guide: {
      bn: ".gcai <প্রশ্ন>",
      en: ".gcai <question>"
    }
  },

  onStart: async function ({ api, event, args, message, usersData }) {
    const senderID = String(event.senderID);
    if (!core.isOwner(senderID)) {
      console.log(`GroupAI ignored non-owner command from ${senderID}`);
      return;
    }
    let senderName = "Owner";
    try {
      if (usersData && typeof usersData.getName === "function") {
        senderName = await usersData.getName(senderID) || "Owner";
      }
    } catch {
      senderName = "Owner";
    }
    try {
      const response = await core.handleInput(
        { api, event, message, usersData, senderName },
        args.join(" "),
        { starting: true }
      );
      return response ? message.reply(response) : undefined;
    } catch (error) {
      console.error("GroupAI command error:", error.message);
      return message.reply(`❌ ${error.message}`);
    }
  },

  onChat: async function ({ api, event, message, usersData }) {
    const senderID = String(event.senderID);
    if (!core.isOwner(senderID)) return;
    const body = String(event.body || "").trim();
    if (!body || isCommandBody(body)) return;

    // No session means no reply. This prevents unsolicited AI responses.
    const session = core.getThread(event.threadID).session;
    if (!session || !session.active || String(session.ownerID) !== senderID) return;

    let senderName = "Owner";
    try {
      if (usersData && typeof usersData.getName === "function") {
        senderName = await usersData.getName(senderID) || "Owner";
      }
    } catch {
      senderName = "Owner";
    }
    try {
      const response = await core.handleInput(
        { api, event, message, usersData, senderName },
        body
      );
      return response ? message.reply(response) : undefined;
    } catch (error) {
      console.error("GroupAI follow-up error:", error.message);
      return message.reply(`❌ ${error.message}`);
    }
  }
};