/**
 * ULTIMATE AI — combined assistant for GoatBot
 * Combines the useful features of agent and groupai with guarded operations.
 */

const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const ALLOWED_USERS = ["61576355017916", "100082814982394", "100089047474463"];
const ROOT = process.cwd();
const MEMORY_FILE = path.join(__dirname, "cache", "ultimateai_memory.json");
const memory = new Map();
const BLOCKED_NAMES = new Set([".env", ".env.local", ".env.production", "account.txt", "cookies.json", "appstate.json", "token.txt"]);

function loadMemory() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return;
    const data = fs.readJsonSync(MEMORY_FILE);
    for (const [threadID, value] of Object.entries(data)) {
      memory.set(threadID, {
        messages: Array.isArray(value.messages) ? value.messages.slice(-50) : {},
        members: value.members || {}
      });
    }
  } catch (error) {
    console.error("UltimateAI memory load error:", error.message);
  }
}

function saveMemory() {
  try {
    fs.ensureDirSync(path.dirname(MEMORY_FILE));
    const data = {};
    for (const [threadID, value] of memory.entries()) {
      data[threadID] = {
        messages: (value.messages || []).slice(-50),
        members: value.members || {}
      };
    }
    fs.writeJsonSync(MEMORY_FILE, data, { spaces: 2 });
  } catch (error) {
    console.error("UltimateAI memory save error:", error.message);
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
  thread.messages = thread.messages.slice(-50);
  saveMemory();
}

function isAllowed(senderID) {
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
  if (BLOCKED_NAMES.has(name) || name.includes("cookie") || name.includes("token")) {
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
    console.error("UltimateAI API error:", error.message);
    return null;
  }
}

async function getFacebookApi() {
  const api = global.GoatBot?.fcaApi || global.api;
  return api || null;
}

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
  const response = await axios.get(endpoint, { timeout: 30000, headers: { "User-Agent": "UltimateAI-GoatBot" } });
  return { owner, repo, data: response.data };
}

function helpMessage() {
  return [
    "🤖 ULTIMATE AI COMMAND",
    "",
    ".ultimateai <প্রশ্ন> — AI assistant",
    ".ultimateai read <file> — ফাইল পড়ুন",
    ".ultimateai write <file> <text> — ফাইল লিখুন",
    ".ultimateai edit <file> <old> => <new> — ফাইল edit করুন",
    ".ultimateai delete <file> confirm — ফাইল delete করুন",
    ".ultimateai list [folder] — ফাইল list করুন",
    ".ultimateai check <file.js> — syntax check করুন",
    ".ultimateai github <repo-url> [path] — GitHub repo/file পড়ুন",
    ".ultimateai fb post|like|comment|read|info — Facebook কাজ",
    ".ultimateai status|analyze|predict|problems — system analysis",
    "",
    "নিরাপত্তার জন্য commandটি শুধু অনুমোদিত user-দের জন্য।"
  ].join("\n");
}

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
    return "📂 " + filePath + "\n\n" + folder.slice(0, 100).map(name => "• " + name).join("\n");
  }
  throw new Error("Unknown file command");
}

async function runFacebookCommand(args) {
  const api = await getFacebookApi();
  if (!api) throw new Error("Facebook API initialized নয়");
  const subcommand = String(args[1] || "").toLowerCase();
  if (subcommand === "post") {
    const content = args.slice(2).join(" ");
    if (!content) throw new Error("Post text দিন");
    await api.sendMessage(content, api.getCurrentUserID());
    return "✅ Facebook post পাঠানো হয়েছে";
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
    return "✅ Comment করা হয়েছে";
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

async function buildAIReply(threadID, senderName, question) {
  const thread = getThread(threadID);
  const language = detectLanguage(question);
  const history = thread.messages.slice(-10).map(item => item.name + ": " + item.body).join("\n");
  const systemPrompt = "You are a helpful GoatBot assistant. Answer in " + language + ". Do not claim to have performed actions you did not perform. Be concise and practical.\nRecent context:\n" + history;
  const answer = await askAI(systemPrompt, question);
  addMessage(threadID, senderName, question);
  if (answer) addMessage(threadID, "UltimateAI", answer);
  return answer || "AI service এখন উত্তর দিচ্ছে না। কিছুক্ষণ পর আবার চেষ্টা করুন।";
}

module.exports = {
  config: {
    name: "ultimateai",
    aliases: ["uai", "ultimate", "agentx"],
    version: "1.0.0",
    author: "System",
    countDown: 3,
    role: 4,
    shortDescription: {
      bn: "সব দরকারি AI ও bot tools এক কমান্ডে",
      en: "Combined AI and bot tools"
    },
    category: "AI/Development",
    guide: {
      bn: ".ultimateai help",
      en: ".ultimateai help"
    }
  },

  onStart: async function ({ api, event, args, message, usersData }) {
    const senderID = String(event.senderID);
    if (!isAllowed(senderID)) return message.reply("🔒 এই command অনুমোদিত user-দের জন্য בלבד।");
    const command = String(args[0] || "").toLowerCase();
    const senderName = usersData && usersData.getName ? await usersData.getName(senderID).catch(() => "User") : "User";

    try {
      if (!command || command === "help" || command === "h" || command === "?") return message.reply(helpMessage());
      if (["read", "write", "edit", "delete", "list", "ls", "check", "test"].includes(command)) {
        return message.reply(await runFileCommand(command, args));
      }
      if (command === "fb" || command === "facebook") return message.reply(await runFacebookCommand(args));
      if (command === "github" || command === "repo") {
        const result = await githubRequest(args[1], args[2]);
        if (Array.isArray(result.data)) {
          return message.reply("🐙 " + result.owner + "/" + result.repo + "\n\n" + result.data.slice(0, 50).map(item => (item.type === "dir" ? "📁 " : "📄 ") + item.name).join("\n"));
        }
        const content = result.data.content ? Buffer.from(result.data.content.replace(/\n/g, ""), "base64").toString("utf8") : JSON.stringify(result.data, null, 2);
        return message.reply("📄 " + result.data.path + "\n\n" + content.slice(0, 15000));
      }
      if (command === "status" || command === "analyze") {
        const usage = process.memoryUsage();
        const cmdDir = path.join(ROOT, "scripts", "cmds");
        const commandCount = (await fs.pathExists(cmdDir)) ? (await fs.readdir(cmdDir)).filter(name => name.endsWith(".js")).length : 0;
        return message.reply("📊 UltimateAI status\n\n✅ Active\n📂 Commands: " + commandCount + "\n💾 Heap: " + (usage.heapUsed / 1024 / 1024).toFixed(1) + " MB\n⏱️ Uptime: " + formatUptime(process.uptime()));
      }
      if (command === "predict") {
        const usage = process.memoryUsage();
        const ratio = usage.heapUsed / usage.heapTotal;
        return message.reply(ratio > 0.8 ? "⚠️ Heap usage 80%+; restart বিবেচনা করুন।" : "✅ Memory usage স্বাভাবিক দেখাচ্ছে।");
      }
      if (command === "problems" || command === "issue") {
        const problems = [];
        if (!(await fs.pathExists(path.join(ROOT, "scripts", "cmds")))) problems.push("scripts/cmds folder পাওয়া যায়নি");
        if (problems.length === 0) return message.reply("✅ Basic project checks-এ সমস্যা পাওয়া যায়নি।");
        return message.reply("⚠️ সমস্যা:\n" + problems.map(item => "• " + item).join("\n"));
      }
      return message.reply(await buildAIReply(event.threadID, senderName, args.join(" ")));
    } catch (error) {
      console.error("UltimateAI command error:", error);
      return message.reply("❌ " + error.message);
    }
  },

  onChat: async function ({ event, message, usersData }) {
    const senderID = String(event.senderID);
    const body = String(event.body || "");
    if (!body || !isAllowed(senderID)) return;
    if (!/\bultimateai\b/i.test(body) && !body.includes("Ultimate AI")) return;
    const question = body.replace(/ultimateai/gi, "").replace(/ultimate ai/gi, "").trim();
    if (!question) return message.reply("🤖 বলুন, আমি শুনছি।");
    const senderName = usersData && usersData.getName ? await usersData.getName(senderID).catch(() => "User") : "User";
    try {
      return message.reply(await buildAIReply(event.threadID, senderName, question));
    } catch (error) {
      return message.reply("❌ " + error.message);
    }
  }
};
