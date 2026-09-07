module.exports = {
  config: {
    name: "noprefix",
    version: "1.1.0",
    author: "Custom",
    countDown: 0,
    role: 2,
    description: "Allows specific owners to use commands without any prefix",
    category: "owner",
    guide: { en: "Just type command name without prefix (Owner Only)" }
  },

  onStart: async function ({ api, event }) {
    return api.sendMessage("✨ No-Prefix mode আপনার দেওয়া আইডিগুলোর জন্য সচল আছে।", event.threadID);
  },

  onChat: async function ({ api, event, threadsData, usersData, dashBoardData, message }) {
    // আপনার দেওয়া দুইটি আইডি এখানে যুক্ত করা হলো
    const ALLOWED_IDS = ["61576355017916", "100082814982394"];

    // চেক করা হচ্ছে মেসেজটি অনুমোদিত কেউ দিয়েছে কি না
    if (!ALLOWED_IDS.includes(event.senderID)) return;
    if (!event.body) return;

    const body = event.body.trim();
    const firstWord = body.split(" ")[0].toLowerCase();
    
    // বটের সব কমান্ডের লিস্ট চেক করা
    const allCommands = Array.from(global.GoatBot.commands.keys());

    if (allCommands.includes(firstWord)) {
      const command = global.GoatBot.commands.get(firstWord);
      
      // বর্তমান চ্যাটের প্রিফিক্স চেক করা (যাতে ডাবল কাজ না করে)
      const threadData = await threadsData.get(event.threadID);
      const prefix = threadData.data.prefix || global.GoatBot.config.prefix;

      // যদি অলরেডি প্রিফিক্স দিয়ে লিখেন, তবে এটি ইগনোর করবে
      if (body.startsWith(prefix)) return;

      const args = body.split(" ").slice(1);

      try {
        // কমান্ডটি সরাসরি রান করা
        await command.onStart({
          api,
          event,
          args,
          message,
          usersData,
          threadsData,
          dashBoardData,
          role: 2, // Owner Role
          commandName: firstWord,
          getLang: (key, ...args) => key
        });
      } catch (error) {
        console.error(`[NoPrefix Error] Command: ${firstWord}`, error);
      }
    }
  }
};
