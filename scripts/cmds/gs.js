module.exports = {
  config: {
    name: "gs",
    version: "1.0.0",
    author: "Replit",
    countDown: 5,
    role: 0,
    shortDescription: { en: "GoatStore command" },
    longDescription: { en: "GoatStore command is temporarily unavailable because the original file was incomplete." },
    category: "system",
    guide: { en: "{pn}" }
  },
  onStart: async function ({ message }) {
    return message.reply("⚠️ GoatStore command is temporarily unavailable. The original gs.js file was incomplete.");
  }
};
