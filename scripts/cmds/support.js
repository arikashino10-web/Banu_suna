const SUPPORT_INVITE =
  "https://m.me/j/AbZuPvoJfy0AMP4k/?send_source=gc%3Acopy_invite_link_t";

// Optional: put your Support group Thread ID here for auto-add.
// Example: "1234567890123456"
// Leave empty ("") to only send the invite link.
const SUPPORT_THREAD_ID = "";

module.exports = {
  config: {
    name: "support",
    aliases: ["sp", "helpsupport", "joinsupport"],
    version: "1.0.0",
    author: "Banu",
    countDown: 5,
    role: 0,
    description: {
      en: "Join the official support group",
      bn: "অফিসিয়াল সাপোর্ট গ্রুপে যুক্ত হন"
    },
    category: "utility",
    guide: {
      en: "{pn} — join the support group",
      bn: "{pn} — সাপোর্ট গ্রুপে যোগ দিন"
    }
  },

  onStart: async function ({ api, event, message }) {
    const { senderID, threadID, messageID } = event;

    // 1) If SUPPORT_THREAD_ID is set → try direct add
    if (SUPPORT_THREAD_ID && /^\d+$/.test(String(SUPPORT_THREAD_ID))) {
      try {
        const info = await api.getThreadInfo(SUPPORT_THREAD_ID);
        const participants = (info.participantIDs || []).map(String);

        if (participants.includes(String(senderID))) {
          return message.reply(
            "✅ আপনি ইতিমধ্যেই সাপোর্ট গ্রুপে আছেন!\n\n" +
              `🔗 Group: ${info.threadName || "Support"}\n` +
              `📩 Invite (backup): ${SUPPORT_INVITE}`
          );
        }

        await api.addUserToGroup(senderID, SUPPORT_THREAD_ID);

        const botID = String(api.getCurrentUserID());
        const adminIDs = (info.adminIDs || []).map((a) => String(a.id || a));
        const botIsAdmin = adminIDs.includes(botID);

        if (info.approvalMode && !botIsAdmin) {
          return message.reply(
            "📨 সাপোর্ট গ্রুপের approval list-এ আপনাকে অ্যাড করা হয়েছে।\n" +
              "অ্যাডমিন অ্যাপ্রুভ করলেই গ্রুপে ঢুকতে পারবেন।\n\n" +
              `অথবা সরাসরি জয়েন লিংক:\n${SUPPORT_INVITE}`
          );
        }

        return message.reply(
          `✅ আপনাকে সাপোর্ট গ্রুপে যুক্ত করা হয়েছে!\n` +
            `📌 Group: ${info.threadName || "Support"}\n\n` +
            `লিংক (প্রয়োজনে): ${SUPPORT_INVITE}`
        );
      } catch (err) {
        // Fall through to invite link
        console.error("[support] addUserToGroup failed:", err?.message || err);
      }
    }

    // 2) Fallback / default — send invite link (always works)
    return message.reply(
      "🆘 𝗦𝗨𝗣𝗣𝗢𝗥𝗧 𝗚𝗥𝗢𝗨𝗣\n" +
        "━━━━━━━━━━━━━━\n" +
        "নিচের লিংকে ক্লিক করে সাপোর্ট গ্রুপে জয়েন করুন:\n\n" +
        `🔗 ${SUPPORT_INVITE}\n\n` +
        "ক্লিক করার পর Facebook/Messenger এ Open চাপলেই গ্রুপে ঢুকে যাবেন।"
    );
  }
};
