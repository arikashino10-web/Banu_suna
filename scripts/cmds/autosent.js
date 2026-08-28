const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const WHITELIST_PATH = path.join(__dirname, "autosent_whitelist.json");

// ========== Whitelist ==========
let WHITELIST = [
  // এখানে চাইলে আগে থেকে Thread ID দিতে পারো
  // "1000xxxxxxxxxxxx",
];

function loadWhitelist() {
  try {
    if (fs.existsSync(WHITELIST_PATH)) {
      const loaded = JSON.parse(fs.readFileSync(WHITELIST_PATH, "utf8"));
      if (!Array.isArray(loaded)) throw new Error("Whitelist must be an array");
      WHITELIST = loaded.map(id => String(id).trim()).filter(Boolean);
    } else {
      saveWhitelist();
    }
  } catch (e) {
    WHITELIST = [];
  }
}

function saveWhitelist() {
  try {
    fs.writeFileSync(WHITELIST_PATH, JSON.stringify(WHITELIST, null, 2));
  } catch (e) {}
}

loadWhitelist();

module.exports = {
  config: {
    name: "autosent",
    version: "21.2.0",
    author: "System",
    countDown: 0,
    role: 0,
    category: "system"
  },

  onStart: async function ({ api, event, args }) {
    const threadID = event.threadID;
    const input = (args[0] || "").toLowerCase();

    const ownerIDs = ["61576355017916", "100082814982394", "100089047474463"];
    if (["add", "remove", "list", "test"].includes(input) && !ownerIDs.includes(String(event.senderID))) {
      return api.sendMessage("🔒 এই autosent command শুধু অনুমোদিত owner ব্যবহার করতে পারবেন।", threadID);
    }

    // ===== HELP =====
    if (input === "help" || input === "") {
      return api.sendMessage(
`🤖 𝗔𝗨𝗧𝗢𝗦𝗘𝗡𝗧 𝗛𝗘𝗟𝗣
━━━━━━━━━━━━━━━━━━
📌 Available Commands:

• .autosent help
  → সব কমান্ড দেখাবে

• .autosent add
  → বর্তমান গ্রুপ Whitelist-এ যোগ করবে

• .autosent remove
  → বর্তমান গ্রুপ Whitelist থেকে বাদ দিবে

• .autosent list
  → Whitelist-এ থাকা সব গ্রুপ দেখাবে

• .autosent test
  → শুধু Whitelist গ্রুপে টেস্ট মেসেজ + ভিডিও পাঠাবে

━━━━━━━━━━━━━━━━━━
⚙️ System Features:
• প্রতি ২ ঘণ্টায় অটো মেসেজ + ভিডিও
• Daily Report (00:05 BD Time)
• Silence Detector (৯০ মিনিট নীরব থাকলে)
• শুধু Whitelist গ্রুপেই মেসেজ যায়

📋 বর্তমান Whitelist: ${WHITELIST.length}টি গ্রুপ
━━━━━━━━━━━━━━━━━━`,
        threadID
      );
    }

    // ===== ADD =====
    if (input === "add") {
      if (WHITELIST.includes(threadID)) {
        return api.sendMessage("⚠️ এই গ্রুপ আগে থেকেই Whitelist-এ আছে।", threadID);
      }
      WHITELIST.push(threadID);
      saveWhitelist();
      return api.sendMessage(`✅ এই গ্রুপ Whitelist-এ যোগ করা হয়েছে।\nThread ID: ${threadID}`, threadID);
    }

    // ===== REMOVE =====
    if (input === "remove") {
      if (!WHITELIST.includes(threadID)) {
        return api.sendMessage("⚠️ এই গ্রুপ Whitelist-এ নেই।", threadID);
      }
      WHITELIST = WHITELIST.filter(id => id !== threadID);
      saveWhitelist();
      return api.sendMessage(`🗑️ এই গ্রুপ Whitelist থেকে বাদ দেওয়া হয়েছে।`, threadID);
    }

    // ===== LIST =====
    if (input === "list") {
      if (WHITELIST.length === 0) {
        return api.sendMessage("📭 Whitelist খালি।\nযোগ করতে: .autosent add", threadID);
      }
      return api.sendMessage(
        `📋 Whitelist (${WHITELIST.length}টি গ্রুপ):\n\n` +
        WHITELIST.map((id, i) => `${i + 1}. ${id}`).join("\n"),
        threadID
      );
    }

    // ===== TEST =====
    if (input === "test") {
      if (WHITELIST.length === 0) {
        return api.sendMessage("⚠️ আগে গ্রুপ Whitelist-এ যোগ করুন।\nকমান্ড: .autosent add", threadID);
      }
      api.sendMessage("⏳ শুধু Whitelist গ্রুপে টেস্ট পাঠানো হচ্ছে...", threadID);
      for (const id of WHITELIST) {
        await sendV(api, id, "✅ টেস্ট সফল!\n━━━━━━━━━━━━\n✅ Test Successful!", "https://files.catbox.moe/6in51c.mp4");
        await new Promise(r => setTimeout(r, 2000));
      }
      return;
    }

    // অজানা কমান্ড
    return api.sendMessage("❌ অজানা কমান্ড!\nসব কমান্ড দেখতে লিখুন: .autosent help", threadID);
  },

  onLoad: async function ({ api }) {
    if (global.autoInterval) clearInterval(global.autoInterval);
    console.log("=== [AUTOSENT] Whitelist System সচল হয়েছে ===");

    global.autosentData = global.autosentData || {
      activity: {},
      dailyMessages: {},
      lastSent: "",
      lastReport: "",
      msgIndex: {},
      silenceIndex: 0
    };

    // ========== ১২টি সময়ের মেসেজ ==========
    const schedule = {
      "00:00": {
        texts: [
          "🌙 রাত ১২টা বাজে।\nআজকের দিনটা এখানেই শেষ।\nযা খারাপ হয়েছে সেটা আজকের সাথেই রেখে দাও।\nকাল আবার নতুন একটা দিন। ❤️\n━━━━━━━━━━━━\n🌙 It's 12 AM.\nToday ends here.\nLeave the bad things with today.\nTomorrow is a new day. ❤️",
          "🕛 MIDNIGHT CHECK\n\nসবাইকে একটা কথা—\nআজকের ভুলগুলো নিয়ে ঘুমাতে যেও না।\nকাল আবার নতুন করে শুরু করা যাবে। 🌙\n━━━━━━━━━━━━\n🕛 MIDNIGHT CHECK\n\nOne thing for everyone—\nDon't sleep with today's mistakes.\nYou can start fresh tomorrow. 🌙",
          "🌌 রাত অনেক হয়েছে।\n\nহয়তো কেউ ঘুমিয়ে গেছে,\nকেউ এখনো online,\nআর কেউ নিজের চিন্তার সাথে যুদ্ধ করছে।\n\nGood Night. ❤️\n━━━━━━━━━━━━\n🌌 It's late at night.\n\nMaybe someone is sleeping,\nsomeone is still online,\nand someone is fighting with their thoughts.\n\nGood Night. ❤️"
        ],
        vid: "https://files.catbox.moe/dg3wxa.mp4"
      },
      "02:00": {
        texts: [
          "🌙 রাত ২টা!\n\nএখনো জেগে আছো?\nঘুম তোমাকে block করেছে নাকি তুমি ঘুমকে block করেছো? 😂\n━━━━━━━━━━━━\n🌙 It's 2 AM!\n\nStill awake?\nDid sleep block you or did you block sleep? 😂",
          "👀 2:00 AM\n\nএই সময় যারা জেগে থাকে,\nতাদের দুইটা কারণ থাকে—\nঅতিরিক্ত চিন্তা অথবা অতিরিক্ত scrolling. 😂\n━━━━━━━━━━━━\n👀 2:00 AM\n\nThose who stay awake at this time\nusually have two reasons—\ntoo much overthinking or too much scrolling. 😂",
          "🌌 রাত ২টা বাজে।\n\nচোখ দুটোকে একটু rest দাও।\nFacebook পৃথিবী তোমাকে ছাড়া এক ঘণ্টা চলবে। 😂\n━━━━━━━━━━━━\n🌌 It's 2 AM.\n\nGive your eyes some rest.\nThe Facebook world will run without you for an hour. 😂"
        ],
        vid: "https://files.catbox.moe/f3h67p.mp4"
      },
      "04:00": {
        texts: [
          "🌅 ভোর ৪টা...\n\nআর কিছুক্ষণ পরেই সকাল।\nরাত যতই দীর্ঘ হোক,\nশেষে সকাল আসবেই। ❤️\n━━━━━━━━━━━━\n🌅 It's 4 AM...\n\nMorning is coming soon.\nNo matter how long the night is,\nmorning will always arrive. ❤️",
          "🌌 4:00 AM\n\nপৃথিবী এখন অনেক শান্ত।\nনিজের জন্য কয়েক মিনিট রাখো।\n━━━━━━━━━━━━\n🌌 4:00 AM\n\nThe world is very quiet now.\nKeep a few minutes for yourself.",
          "🕌 ভোরের সময় কাছাকাছি।\n\nনিজেকে একটু শান্ত করো।\nনতুন দিনের জন্য প্রস্তুত হও।\n━━━━━━━━━━━━\n🕌 Dawn is near.\n\nCalm yourself a little.\nGet ready for a new day."
        ],
        vid: "https://files.catbox.moe/wi2y1i.mp4"
      },
      "06:00": {
        texts: [
          "☀️ GOOD MORNING!\n\nনতুন সকাল, নতুন সুযোগ।\nআজকের দিনটা গতকালের চেয়ে একটু ভালো করার চেষ্টা করো। ❤️\n━━━━━━━━━━━━\n☀️ GOOD MORNING!\n\nNew morning, new chance.\nTry to make today a little better than yesterday. ❤️",
          "🌞 সকাল ৬টা!\n\nউঠে পড়ো।\nএক গ্লাস পানি খাও।\nতারপর দিন শুরু করো।\n━━━━━━━━━━━━\n🌞 It's 6 AM!\n\nWake up.\nDrink a glass of water.\nThen start your day.",
          "☀️ MORNING SYSTEM ACTIVATED!\n\nআজকের Mission:\nনিজেকে গতকালের চেয়ে ১% better করা। 🔥\n━━━━━━━━━━━━\n☀️ MORNING SYSTEM ACTIVATED!\n\nToday's Mission:\nMake yourself 1% better than yesterday. 🔥"
        ],
        vid: "https://files.catbox.moe/3b5km4.mp4"
      },
      "08:00": {
        texts: [
          "🍳 সকাল ৮টা!\n\nনাস্তা করেছো?\nনাকি আবার মোবাইলটাই breakfast হয়ে গেছে? 😂\n━━━━━━━━━━━━\n🍳 It's 8 AM!\n\nHad breakfast?\nOr has the phone become your breakfast again? 😂",
          "☀️ 8:00 AM\n\nযে কাজটা অনেকদিন ধরে পিছিয়ে দিচ্ছো,\nআজ সেটার শুরুটা করে ফেলো।\n━━━━━━━━━━━━\n☀️ 8:00 AM\n\nThat work you've been postponing for days—\nstart it today.",
          "🥐 BREAKFAST CHECK!\n\nআগে নাস্তা করো,\nতারপর দুনিয়া জয় করতে বের হও। 😂🔥\n━━━━━━━━━━━━\n🥐 BREAKFAST CHECK!\n\nEat first,\nthen go conquer the world. 😂🔥"
        ],
        vid: "https://files.catbox.moe/qlp4ap.mp4"
      },
      "10:00": {
        texts: [
          "🧠 সকাল ১০টা।\n\nঘড়ি কিন্তু থেমে নেই।\nসময়কে কাজে লাগাও।\n━━━━━━━━━━━━\n🧠 It's 10 AM.\n\nThe clock isn't stopping.\nUse your time well.",
          "⚡ 10:00 AM\n\nআজকের সবচেয়ে গুরুত্বপূর্ণ কাজটা এখনই শুরু করো।\n━━━━━━━━━━━━\n⚡ 10:00 AM\n\nStart today's most important task right now.",
          "👀 ছোট্ট reminder:\n\nতোমার future version তোমার আজকের decision-এর উপর নির্ভর করছে।\n━━━━━━━━━━━━\n👀 Small reminder:\n\nYour future version depends on today's decisions."
        ],
        vid: "https://files.catbox.moe/td7ps7.mp4"
      },
      "12:00": {
        texts: [
          "🌤️ দুপুর ১২টা!\n\nঅর্ধেক দিন প্রায় শেষ।\nআজ এখন পর্যন্ত কী করেছো?\nনিজেকে ১০-এর মধ্যে কত দেবে? 👀\n━━━━━━━━━━━━\n🌤️ It's 12 PM!\n\nAlmost half the day is over.\nWhat have you done so far?\nRate yourself out of 10. 👀",
          "🥤 MIDDAY CHECK\n\nপানি খাও।\nচোখকে একটু বিশ্রাম দাও।\n━━━━━━━━━━━━\n🥤 MIDDAY CHECK\n\nDrink water.\nGive your eyes some rest.",
          "☀️ GOOD AFTERNOON!\n\nসকালের plan নষ্ট হলেও সমস্যা নেই।\nদিন এখনো শেষ হয়নি। Restart করা যায়। 🔥\n━━━━━━━━━━━━\n☀️ GOOD AFTERNOON!\n\nEven if the morning plan failed, it's okay.\nThe day isn't over yet. You can restart. 🔥"
        ],
        vid: "https://files.catbox.moe/1a18es.mp4"
      },
      "14:00": {
        texts: [
          "🍛 দুপুর ২টা।\n\nখাওয়া হয়েছে?\nনাকি group-এর message পড়তে পড়তে lunch ভুলে গেছো? 😂\n━━━━━━━━━━━━\n🍛 It's 2 PM.\n\nHave you eaten?\nOr did you forget lunch while reading group messages? 😂",
          "😌 2:00 PM\n\nএকটু slow হও।\nসবকিছু একসাথে ঠিক করতে হবে না।\n━━━━━━━━━━━━\n😌 2:00 PM\n\nSlow down a little.\nYou don't have to fix everything at once.",
          "🕌 Afternoon Reminder\n\nনিজের প্রয়োজনীয় কাজগুলো শেষ করো।\nদিন এখনো অনেকটা বাকি।\n━━━━━━━━━━━━\n🕌 Afternoon Reminder\n\nFinish your necessary tasks.\nThere's still a lot of day left."
        ],
        vid: "https://files.catbox.moe/pamsg5.mp4"
      },
      "16:00": {
        texts: [
          "🌇 বিকেল ৪টা।\n\nআজকের দিনটা এখনো তোমার হাতে আছে।\nআরও ভালো কিছু করা যায়। 🔥\n━━━━━━━━━━━━\n🌇 It's 4 PM.\n\nToday is still in your hands.\nYou can still do something better. 🔥",
          "🚶 বিকেলের reminder:\n\nসম্ভব হলে একটু হাঁটাহাঁটি করো।\nশুধু screen-এর দিকে তাকিয়ে থেকো না। 😂\n━━━━━━━━━━━━\n🚶 Afternoon reminder:\n\nIf possible, take a short walk.\nDon't just keep staring at the screen. 😂",
          "⏳ 4:00 PM\n\nআজকের কতটা সময় useful ছিল?\nনিজের কাছে সত্যি উত্তরটা দিও।\n━━━━━━━━━━━━\n⏳ 4:00 PM\n\nHow much of today's time was useful?\nGive yourself an honest answer."
        ],
        vid: "https://files.catbox.moe/6in51c.mp4"
      },
      "18:00": {
        texts: [
          "🌆 GOOD EVENING!\n\nদিনটা ধীরে ধীরে শেষ হচ্ছে।\nএকটু শান্ত হও। ❤️\n━━━━━━━━━━━━\n🌆 GOOD EVENING!\n\nThe day is slowly ending.\nCalm down a little. ❤️",
          "🌇 সন্ধ্যা ৬টা।\n\nমোবাইলের বাইরেও একটা পৃথিবী আছে।\nপরিবারের সাথে একটু সময় কাটাও।\n━━━━━━━━━━━━\n🌇 It's 6 PM.\n\nThere's a world outside the phone.\nSpend some time with family.",
          "🕌 সন্ধ্যার সময়।\n\nসারাদিনের ব্যস্ততার মাঝে কয়েক মিনিট নিজের জন্য রাখো।\n━━━━━━━━━━━━\n🕌 Evening time.\n\nIn the middle of the whole day's hustle, keep a few minutes for yourself."
        ],
        vid: "https://files.catbox.moe/1wil0m.mp4"
      },
      "20:00": {
        texts: [
          "🍽️ রাত ৮টা!\n\nDinner Check!\nখাবার খেয়েছো তো?\nনাকি এখনো group-এ পড়ে আছো? 😂\n━━━━━━━━━━━━\n🍽️ It's 8 PM!\n\nDinner Check!\nHave you eaten?\nOr are you still stuck in the group? 😂",
          "🌃 8:00 PM\n\nএকটু family time,\nএকটু হাসি,\nআর একটু নিজের জন্য সময়। ❤️\n━━━━━━━━━━━━\n🌃 8:00 PM\n\nA little family time,\na little smile,\nand a little time for yourself. ❤️",
          "😌 রাত ৮টা।\n\nআজকের কাজ সব শেষ না হলেও সমস্যা নেই।\nযতটুকু পেরেছো, সেটুকুর জন্য নিজেকে credit দাও।\n━━━━━━━━━━━━\n😌 It's 8 PM.\n\nIt's okay if you didn't finish everything today.\nGive yourself credit for what you did manage."
        ],
        vid: "https://files.catbox.moe/mcx3hp.mp4"
      },
      "22:00": {
        texts: [
          "🌙 রাত ১০টা।\n\nআজকে অনেক screen time হয়েছে।\nআর কতক্ষণ scroll করবে? 😂\n━━━━━━━━━━━━\n🌙 It's 10 PM.\n\nYou've had a lot of screen time today.\nHow much longer will you scroll? 😂",
          "🛌 10:00 PM\n\nকালকের জন্য mind-টাকে একটু rest দাও।\nসব problem আজ রাতেই solve করতে হবে না।\n━━━━━━━━━━━━\n🛌 10:00 PM\n\nGive your mind some rest for tomorrow.\nYou don't have to solve every problem tonight.",
          "🌙 GOOD NIGHT MODE: 70%\n\nদিনটা কেমন গেল?\nভালো হলে মনে রেখো।\nখারাপ হলে ছেড়ে দাও।\nকাল আবার চেষ্টা করা যাবে। ❤️\n━━━━━━━━━━━━\n🌙 GOOD NIGHT MODE: 70%\n\nHow was your day?\nIf it was good, remember it.\nIf it was bad, let it go.\nYou can try again tomorrow. ❤️"
        ],
        vid: "https://files.catbox.moe/mmf2pw.mp4"
      }
    };

    // ========== সাইলেন্স মেসেজ ==========
    const silenceMessages = [
      "🦗🦗🦗\nএখানে এত নীরবতা কেন?\nঝিঁঝিঁ পোকার শব্দও শুনতে পাচ্ছি। 😂\n━━━━━━━━━━━━\n🦗🦗🦗\nWhy is it so quiet here?\nI can even hear the crickets. 😂",
      "👀 এই গ্রুপে কি সবাই invisible হয়ে গেলো?\n━━━━━━━━━━━━\n👀 Did everyone in this group turn invisible?",
      "📡 GROUP SIGNAL CHECK...\n\nকেউ কি আছো?\nনাকি সবাই অন্য গ্রুপে পালিয়ে গেছো? 😂\n━━━━━━━━━━━━\n📡 GROUP SIGNAL CHECK...\n\nIs anyone here?\nOr did everyone run away to another group? 😂",
      "🤖 আমি এক ঘণ্টা ধরে অপেক্ষা করছি...\n\nকেউ একটা 'হাই' বললেও চলবে। 🥲\n━━━━━━━━━━━━\n🤖 I've been waiting for an hour...\n\nEven a simple 'hi' would be fine. 🥲",
      "😶 এত চুপচাপ কেন?\n\nএই group কি এখন library হয়ে গেছে?\n━━━━━━━━━━━━\n😶 Why so silent?\n\nHas this group turned into a library?",
      "🚨 SILENCE DETECTED!\n\nগত এক ঘণ্টায় কোনো activity পাওয়া যায়নি।\n━━━━━━━━━━━━\n🚨 SILENCE DETECTED!\n\nNo activity found in the last hour.",
      "👻 GHOST MODE ACTIVATED\n\nসবাই কি একসাথে ghost হয়ে গেছো? 👻\n━━━━━━━━━━━━\n👻 GHOST MODE ACTIVATED\n\nDid everyone become ghosts together? 👻"
    ];

    global.autoInterval = setInterval(async () => {
      if (!WHITELIST || WHITELIST.length === 0) return;

      const bd = new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
      const now = new Date(bd);
      const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const sentKey = dateKey + " " + hm;

      // ১. মেইন মেসেজ (প্রতি ২ ঘণ্টা)
      if (schedule[hm] && global.autosentData.lastSent !== sentKey) {
        global.autosentData.lastSent = sentKey;
        const list = schedule[hm].texts;
        if (!global.autosentData.msgIndex[hm]) global.autosentData.msgIndex[hm] = 0;
        const idx = global.autosentData.msgIndex[hm] % list.length;
        const text = list[idx];
        global.autosentData.msgIndex[hm]++;

        for (const id of WHITELIST) {
          await sendV(api, id, text, schedule[hm].vid);
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      // ২. ডেইলি রিপোর্ট (00:05)
      if (hm === "00:05" && global.autosentData.lastReport !== dateKey) {
        global.autosentData.lastReport = dateKey;
        for (const id of WHITELIST) {
          const count = global.autosentData.dailyMessages[id] || 0;
          api.sendMessage(
            `📊 𝗗𝗔𝗜𝗟𝗬 𝗥𝗘𝗣𝗢𝗥𝗧\n━━━━━━━━━━━━━\n💬 আজকের মোট মেসেজ: ${count}\n━━━━━━━━━━━━\n💬 Total messages today: ${count}\n🌙 দিনটি সবার কেমন কাটলো?`,
            id
          );
          global.autosentData.dailyMessages[id] = 0;
        }
      }

      // ৩. সাইলেন্স ডিটেক্টর
      if (now.getMinutes() % 30 === 0 && now.getSeconds() < 20) {
        for (const id of WHITELIST) {
          const lastActive = global.autosentData.activity[id] || Date.now();
          if (Date.now() - lastActive > 90 * 60 * 1000) {
            const idx = global.autosentData.silenceIndex % silenceMessages.length;
            const text = silenceMessages[idx];
            global.autosentData.silenceIndex++;
            api.sendMessage(text, id);
            global.autosentData.activity[id] = Date.now();
          }
        }
      }
    }, 20000);
  },

  onChat: async function ({ event }) {
    if (!event.threadID) return;
    const id = event.threadID;

    // শুধু whitelist গ্রুপ ট্র্যাক করবে
    if (!WHITELIST.includes(id)) return;

    global.autosentData = global.autosentData || { activity: {}, dailyMessages: {} };
    global.autosentData.activity[id] = Date.now();
    global.autosentData.dailyMessages[id] = (global.autosentData.dailyMessages[id] || 0) + 1;
  }
};

async function sendV(api, id, text, url) {
  try {
    const res = await axios.get(url, { responseType: "stream" });
    const msg = text ? { body: text, attachment: res.data } : { attachment: res.data };
    await api.sendMessage(msg, id);
  } catch (e) {
    if (text) await api.sendMessage(text, id);
  }
}
