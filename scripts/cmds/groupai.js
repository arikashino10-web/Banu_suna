/**
 * GROUP AI — Owner Only
 * 🔒 সবকিছুই শুধুমাত্র Owner-এর জন্য
 * 
 * Owners: 61576355017916, 100082814982394
 */

const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

// ─── 🔒 OWNER ONLY ──────────────────────────────────────────────────────────
const ALLOWED_USERS = ["61576355017916", "100082814982394"];
const ROOT = process.cwd();

// ─── 📁 BLOCKED FILES ──────────────────────────────────────────────────────
const BLOCKED_NAMES = new Set([
  ".env", ".env.local", ".env.production", 
  "account.txt", "cookies.json", "appstate.json", 
  "token.txt", "config.json", "credentials.json"
]);

// ─── 💾 MEMORY ──────────────────────────────────────────────────────────────
const MEMORY_FILE = path.join(__dirname, "cache", "groupai_memory.json");
const memory = new Map();

function loadMemory() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return;
    const data = fs.readJsonSync(MEMORY_FILE);
    for (const [threadID, value] of Object.entries(data)) {
      memory.set(threadID, {
        messages: Array.isArray(value.messages) ? value.messages.slice(-100) : [],
        members: value.members || {}
      });
    }
  } catch (error) {
    console.error("GroupAI memory load error:", error.message);
  }
}

function saveMemory() {
  try {
    fs.ensureDirSync(path.dirname(MEMORY_FILE));
    const data = {};
    for (const [threadID, value] of memory.entries()) {
      data[threadID] = {
        messages: (value.messages || []).slice(-100),
        members: value.members || {}
      };
    }
    fs.writeJsonSync(MEMORY_FILE, data, { spaces: 2 });
  } catch (error) {
    console.error("GroupAI memory save error:", error.message);
  }
}

function getThread(threadID) {
  if (!memory.has(threadID)) {
    memory.set(threadID, { messages: [], members: {} });
  }
  return memory.get(threadID);
}

function addMessage(threadID, name, body) {
  const thread = getThread(threadID);
  thread.messages.push({ name, body: String(body).slice(0, 2000), time: Date.now() });
  thread.messages = thread.messages.slice(-100);
  saveMemory();
}

// ─── 🔒 OWNER CHECK ──────────────────────────────────────────────────────
function isOwner(senderID) {
  return ALLOWED_USERS.includes(String(senderID));
}

function safePath(input) {
  const raw = String(input || "").trim();
  if (!raw || raw.includes("\0")) throw new Error("Invalid file path");
  const fullPath = path.resolve(ROOT, raw);
  if (fullPath !== ROOT && !fullPath.startsWith(ROOT + path.sep)) {
    throw new Error("শুধু project folder-এর ভেতরের ফাইল ব্যবহার করা যাবে");
  }
  const name = path.basename(fullPath).toLowerCase();
  if (BLOCKED_NAMES.has(name) || name.includes("cookie") || name.includes("token") || name.includes("secret")) {
    throw new Error("এই ধরনের sensitive file access করা যাবে না");
  }
  return fullPath;
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days ? days + "d" : "", hours ? hours + "h" : "", minutes + "m"].filter(Boolean).join(" ") || "0m";
}

function detectLanguage(text) {
  if (/[\u0980-\u09FF]/.test(text)) return "Bangla";
  if (/[\u0900-\u097F]/.test(text)) return "Hindi";
  if (/[\u0600-\u06FF]/.test(text)) return "Arabic/Urdu";
  return "English";
}

// ─── 🤖 AI CALL ──────────────────────────────────────────────────────────
async function askAI(systemPrompt, userMessage) {
  try {
    const response = await axios.post(
      "https://text.pollinations.ai/",
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        model: "openai",
        private: true
      },
      { timeout: 60000, headers: { "Content-Type": "application/json" } }
    );
    return response.data?.choices?.[0]?.message?.content || response.data?.response || null;
  } catch (error) {
    console.error("GroupAI API error:", error.message);
    return null;
  }
}

// ─── 📱 FACEBOOK API ──────────────────────────────────────────────────────
async function getFacebookApi() {
  const api = global.GoatBot?.fcaApi || global.api;
  return api || null;
}

// ─── 🐙 GITHUB ─────────────────────────────────────────────────────────────
async function githubRequest(repoURL, filePath) {
  const match = String(repoURL || "").match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (!match) throw new Error("সঠিক GitHub URL দিন");
  const owner = match[1];
  const repo = match[2].replace(/\.git$/, "");
  let endpoint = "https://api.github.com/repos/" + owner + "/" + repo + "/contents";
  if (filePath) {
    const encodedPath = String(filePath).split("/").map(part => encodeURIComponent(part)).join("/");
    endpoint += "/" + encodedPath;
  }
  const response = await axios.get(endpoint, { 
    timeout: 30000, 
    headers: { "User-Agent": "GroupAI-GoatBot" } 
  });
  return { owner, repo, data: response.data };
}

// ─── 📋 HELP MESSAGE ──────────────────────────────────────────────────────
function helpMessage() {
  return `👑 **GROUP AI COMMAND** (🔒 Owner Only)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 **AI Assistant:**
.groupai <প্রশ্ন> — যে কোনো ভাষায়

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📂 **File Operations:**
.groupai read <file> — ফাইল পড়ুন
.groupai write <file> <text> — ফাইল লিখুন
.groupai edit <file> <old> => <new> — ফাইল edit করুন
.groupai delete <file> confirm — ফাইল delete করুন
.groupai list [folder] — ফাইল list করুন
.groupai check <file.js> — syntax check করুন

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🐙 **GitHub:**
.groupai github <repo-url> [path] — GitHub repo/file পড়ুন

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 **Facebook:**
.groupai fb post <text> — পোস্ট করুন
.groupai fb like <post_id> — লাইক দিন
.groupai fb comment <post_id> <text> — কমেন্ট করুন
.groupai fb read <thread_id> [limit] — পোস্ট পড়ুন
.groupai fb info [uid] — ইউজার ইনফো

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 **System Analysis:**
.groupai status — স্ট্যাটাস
.groupai analyze — অ্যানালাইসিস
.groupai predict — প্রেডিক্ট
.groupai problems — সমস্যা

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👑 **Owners:** ${ALLOWED_USERS.join(", ")}
🔒 **Everyone else:** Access Denied!`;
}

// ─── 📂 FILE COMMANDS ──────────────────────────────────────────────────
async function runFileCommand(command, args) {
  const filePath = safePath(args[1]);
  
  if (command === "read") {
    if (!(await fs.pathExists(filePath))) throw new Error("ফাইল পাওয়া যায়নি");
    const content = await fs.readFile(filePath, "utf8");
    return "📄 " + filePath + "\n\n" + content.slice(0, 15000);
  }
  
  if (command === "write") {
    const content = args.slice(2).join(" ");
    if (!content) throw new Error("লেখার content দিন");
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, "utf8");
    return "✅ ফাইল লেখা হয়েছে: " + filePath;
  }
  
  if (command === "edit") {
    const raw = args.slice(2).join(" ");
    const separator = raw.indexOf("=>");
    if (separator < 0) throw new Error("Format: edit <file> <old> => <new>");
    const oldText = raw.slice(0, separator).trim();
    const newText = raw.slice(separator + 2).trim();
    if (!oldText) throw new Error("পুরনো text দিন");
    const content = await fs.readFile(filePath, "utf8");
    if (!content.includes(oldText)) throw new Error("পুরনো text পাওয়া যায়নি");
    await fs.writeFile(filePath, content.split(oldText).join(newText), "utf8");
    return "✅ ফাইল edit হয়েছে: " + filePath;
  }
  
  if (command === "delete") {
    if (String(args[2]).toLowerCase() !== "confirm") throw new Error("Delete করতে শেষে confirm লিখুন");
    if (!(await fs.pathExists(filePath))) throw new Error("ফাইল পাওয়া যায়নি");
    await fs.remove(filePath);
    return "✅ ফাইল delete হয়েছে: " + filePath;
  }
  
  if (command === "check" || command === "test") {
    if (path.extname(filePath) !== ".js") throw new Error("শুধু .js file syntax check করা যাবে");
    try {
      await execFileAsync(process.execPath, ["--check", filePath], { cwd: ROOT, timeout: 30000 });
      return "✅ JavaScript syntax ঠিক আছে: " + filePath;
    } catch (error) {
      return "❌ Syntax error: " + (error.stderr || error.message);
    }
  }
  
  if (command === "list" || command === "ls") {
    const folder = await fs.readdir(filePath);
    const items = folder.slice(0, 100).map(name => "• " + name).join("\n");
    return "📂 " + filePath + "\n\n" + items;
  }
  
  throw new Error("Unknown file command");
}

// ─── 📱 FACEBOOK COMMANDS ──────────────────────────────────────────────
async function runFacebookCommand(args) {
  const api = await getFacebookApi();
  if (!api) throw new Error("Facebook API initialized নয়। APPSTATE চেক করুন।");
  
  const subcommand = String(args[1] || "").toLowerCase();
  
  if (subcommand === "post") {
    const content = args.slice(2).join(" ");
    if (!content) throw new Error("Post text দিন");
    await api.sendMessage(content, api.getCurrentUserID());
    return "✅ Facebook post পাঠানো হয়েছে!";
  }
  
  if (subcommand === "like") {
    if (!args[2]) throw new Error("Post ID দিন");
    await api.setMessageReaction("👍", args[2]);
    return "✅ Like দেওয়া হয়েছে: " + args[2];
  }
  
  if (subcommand === "comment") {
    const postID = args[2];
    const content = args.slice(3).join(" ");
    if (!postID || !content) throw new Error("Post ID এবং comment দিন");
    await api.sendMessage(content, postID);
    return "✅ Comment করা হয়েছে!";
  }
  
  if (subcommand === "read") {
    if (!args[2]) throw new Error("Thread ID দিন");
    const info = await api.getThreadInfo(args[2]);
    const messages = await api.getThreadHistory(args[2], Math.min(Number(args[3]) || 10, 30));
    const output = messages.slice(0, 10).map(item => "• " + (item.body || "[attachment]")).join("\n");
    return "📖 " + (info.threadName || "Thread") + "\n\n" + output;
  }
  
  if (subcommand === "info") {
    const uid = args[2] || api.getCurrentUserID();
    const info = await api.getUserInfo(uid);
    const user = info[uid];
    return user ? "👤 " + (user.name || "Unknown") + "\nUID: " + uid : "User পাওয়া যায়নি";
  }
  
  throw new Error("FB command: post, like, comment, read, info");
}

// ─── 💬 AI REPLY ──────────────────────────────────────────────────────────
async function buildAIReply(threadID, senderName, question) {
  const thread = getThread(threadID);
  const language = detectLanguage(question);
  const history = thread.messages.slice(-10).map(item => item.name + ": " + item.body).join("\n");
  
  const systemPrompt = `You are GroupAI — a helpful GoatBot assistant.

LANGUAGE: ${language}

RECENT CONTEXT:
${history || "No previous conversation"}

RULES:
1. Answer in ${language}
2. Be concise and practical
3. Be friendly and helpful
4. Don't claim actions you didn't perform
5. If asked about files/FB/github, suggest the command

USER: ${question}

Your helpful response:`;

  const answer = await askAI(systemPrompt, question);
  addMessage(threadID, senderName, question);
  if (answer) addMessage(threadID, "GroupAI", answer);
  
  return answer || "AI service এখন উত্তর দিচ্ছে না। কিছুক্ষণ পর আবার চেষ্টা করুন। 😊";
}

// ─── 📊 SYSTEM ANALYSIS ──────────────────────────────────────────────────
async function getSystemStatus() {
  const usage = process.memoryUsage();
  const cmdDir = path.join(ROOT, "scripts", "cmds");
  const commandCount = (await fs.pathExists(cmdDir)) ? 
    (await fs.readdir(cmdDir)).filter(name => name.endsWith(".js")).length : 0;
  
  return {
    active: true,
    commands: commandCount,
    heapUsed: (usage.heapUsed / 1024 / 1024).toFixed(1),
    heapTotal: (usage.heapTotal / 1024 / 1024).toFixed(1),
    uptime: formatUptime(process.uptime()),
    memoryItems: memory.size
  };
}

// ─── MAIN MODULE ────────────────────────────────────────────────────────────
module.exports = {
  config: {
    name: "groupai",
    aliases: ["gcai"],
    version: "3.0.0",
    author: "System",
    countDown: 3,
    role: 4,
    shortDescription: {
      bn: "👑 Group AI — শুধু Owner-এর জন্য",
      en: "👑 Group AI — Owner Only"
    },
    category: "AI/Development",
    guide: {
      bn: ".groupai help",
      en: ".groupai help"
    }
  },

  onStart: async function ({ api, event, args, message, usersData }) {
    const senderID = String(event.senderID);
    
    // ─── 🔒 OWNER CHECK ──────────────────────────────────────────────────
    if (!isOwner(senderID)) {
      console.log(`❌ Unauthorized access: ${senderID}`);
      return message.reply(
        `👑 **এই কমান্ড শুধু Owner-এর জন্য!**\n` +
        `আপনার UID: ${senderID}\n` +
        `অনুমোদিত: ${ALLOWED_USERS.join(", ")}\n\n` +
        `🔒 Access Denied!`
      );
    }

    const command = String(args[0] || "").toLowerCase();
    
    // Get sender name
    let senderName = "Owner";
    try {
      if (usersData && typeof usersData.getName === 'function') {
        senderName = await usersData.getName(senderID) || "Owner";
      }
    } catch (e) {
      senderName = "Owner";
    }

    try {
      // ─── HELP ──────────────────────────────────────────────────────────
      if (!command || command === "help" || command === "h" || command === "?") {
        return message.reply(helpMessage());
      }

      // ─── FACEBOOK ──────────────────────────────────────────────────
      if (command === "fb" || command === "facebook") {
        return message.reply(await runFacebookCommand(args));
      }

      // ─── FILE COMMANDS ──────────────────────────────────────────────
      if (["read", "write", "edit", "delete", "list", "ls", "check", "test"].includes(command)) {
        return message.reply(await runFileCommand(command, args));
      }

      // ─── GITHUB ────────────────────────────────────────────────────
      if (command === "github" || command === "repo") {
        const result = await githubRequest(args[1], args[2]);
        if (Array.isArray(result.data)) {
          const files = result.data.slice(0, 50).map(item => 
            (item.type === "dir" ? "📁 " : "📄 ") + item.name
          ).join("\n");
          return message.reply("🐙 " + result.owner + "/" + result.repo + "\n\n" + files);
        }
        const content = result.data.content ? 
          Buffer.from(result.data.content.replace(/\n/g, ""), "base64").toString("utf8") : 
          JSON.stringify(result.data, null, 2);
        return message.reply("📄 " + result.data.path + "\n\n" + content.slice(0, 15000));
      }

      // ─── STATUS & ANALYSIS ──────────────────────────────────────────
      if (command === "status" || command === "analyze") {
        const status = await getSystemStatus();
        return message.reply(
          `👑 **GroupAI Status**
━━━━━━━━━━━━━━━━━━━━

✅ Status: ${status.active ? "Active 🟢" : "Inactive 🔴"}
📂 Commands: ${status.commands}
💾 Heap Used: ${status.heapUsed} MB
💾 Heap Total: ${status.heapTotal} MB
⏱️ Uptime: ${status.uptime}
💬 Memory Items: ${status.memoryItems}

👑 Owners: ${ALLOWED_USERS.join(", ")}
🔒 Access: Owner Only`
        );
      }

      // ─── PREDICT ─────────────────────────────────────────────────────
      if (command === "predict") {
        const usage = process.memoryUsage();
        const ratio = usage.heapUsed / usage.heapTotal;
        if (ratio > 0.8) {
          return message.reply("⚠️ **Memory Alert!**\nHeap usage 80%+।\n💡 Restart বিবেচনা করুন।");
        }
        return message.reply("✅ **Memory Status:** স্বাভাবিক দেখাচ্ছে।\n📊 ব্যবহার: " + (ratio * 100).toFixed(1) + "%");
      }

      // ─── PROBLEMS ──────────────────────────────────────────────────
      if (command === "problems" || command === "issue") {
        const problems = [];
        
        if (!(await fs.pathExists(path.join(ROOT, "scripts", "cmds")))) {
          problems.push("scripts/cmds folder পাওয়া যায়নি");
        }
        if (!(await fs.pathExists(path.join(ROOT, "modules", "cmds")))) {
          problems.push("modules/cmds folder পাওয়া যায়নি");
        }

        const usage = process.memoryUsage();
        if (usage.heapUsed / usage.heapTotal > 0.8) {
          problems.push("উচ্চ মেমরি ব্যবহার (80%+)");
        }

        if (problems.length === 0) {
          return message.reply("✅ **সবকিছু ঠিক আছে!**\nকোনো সমস্যা পাওয়া যায়নি। 😊");
        }
        return message.reply("⚠️ **সমস্যা পাওয়া গেছে:**\n" + problems.map(p => "• " + p).join("\n"));
      }

      // ─── AI QUESTION ─────────────────────────────────────────────────
      if (args.length > 0) {
        const question = args.join(" ");
        const reply = await buildAIReply(event.threadID, senderName, question);
        return message.reply(reply);
      }

      return message.reply(helpMessage());

    } catch (error) {
      console.error("GroupAI command error:", error);
      return message.reply("❌ " + (error.message || "Unknown error"));
    }
  },

  // ─── CHAT MONITOR ──────────────────────────────────────────────────────────
  onChat: async function ({ event, message, usersData }) {
    const senderID = String(event.senderID);
    const body = String(event.body || "");
    
    if (!body) return;
    
    // ─── 🔒 OWNER CHECK ──────────────────────────────────────────────────
    if (!isOwner(senderID)) {
      return; // চুপচাপ ইগনোর করবে
    }
    
    const triggers = ["groupai", "gai", "ga", "ai"];
    const isTriggered = triggers.some(t => body.toLowerCase().includes(t));
    
    if (!isTriggered) return;
    
    const question = body.replace(/groupai|gai|ga|ai/gi, "").trim();
    if (!question) {
      return message.reply("👑 **GroupAI:** বলুন, আমি শুনছি! 😊");
    }
    
    let senderName = "Owner";
    try {
      if (usersData && typeof usersData.getName === 'function') {
        senderName = await usersData.getName(senderID) || "Owner";
      }
    } catch (e) {
      senderName = "Owner";
    }
    
    try {
      const reply = await buildAIReply(event.threadID, senderName, question);
      return message.reply(reply);
    } catch (error) {
      return message.reply("❌ " + error.message);
    }
  }
};
