/**
 * GroupAI v6 — AI প্রশ্নোত্তর + গ্রুপ তথ্য (read-only) + ফাইল ম্যানেজমেন্ট
 * + owner-approved পাওয়ার অ্যাকশন + নিজে থেকে error রিপোর্ট।
 *
 * নিরাপত্তা নীতি:
 * - শুধু OWNERS-এ থাকা ID কমান্ড চালাতে পারবে।
 * - AI কখনো নিজে থেকে ফাইল লেখে/মুছে না, শুধু পরামর্শ দেয়।
 * - ফাইল লেখা/মোছা/শেল কমান্ড — এগুলোই সরাসরি effect করে, বাকি সব শুধু তথ্য।
 * - Facebook-এ কোনো post/message/avatar পাঠানো হয় না — শুধু group info পড়া হয়।
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const { exec, execFile } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

const OWNERS = new Set(["61576355017916", "100082814982394"]);

const MAX_MESSAGES = 200;
const SESSION_TTL_MS = 30 * 60 * 1000;
const SENSITIVE_APPROVAL_MS = 10 * 60 * 1000;
const PENDING_TTL_MS = 5 * 60 * 1000;
const GROUP_INFO_CACHE_MS = 5 * 60 * 1000;
const CACHE_DIR = path.join(__dirname, "cache");
const MEMORY_FILE = path.join(CACHE_DIR, "groupai_memory.json");
const STATS_FILE = path.join(CACHE_DIR, "group_stats.json");
const PENDING_FILE = path.join(CACHE_DIR, "pending_actions.json");

const SENSITIVE_SEGMENTS = new Set([
  ".env", ".env.local", ".env.production", ".env.development",
  "account.txt", "cookies.json", "cookies.js", "appstate.json",
  "token.txt", "credentials.json", "config.json", ".npmrc",
  "id_rsa", "private.pem", "secret.json"
]);

const memory = new Map();
let groupStats = {};
let pendingActions = [];
const groupInfoCache = new Map(); // threadID -> { data, fetchedAt }

let cachedApi = null;      // proactive error message পাঠানোর জন্য
let handlersAttached = false;

// ---------- ছোট JSON store হেল্পার ----------
function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function saveJson(file, data) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch (e) {
    console.error("GroupAI save error:", e.message);
  }
}
function loadAll() {
  const stored = loadJson(MEMORY_FILE, {});
  for (const [threadID, value] of Object.entries(stored)) {
    memory.set(threadID, {
      messages: Array.isArray(value.messages) ? value.messages.slice(-MAX_MESSAGES) : [],
      session: value.session || null
    });
  }
  groupStats = loadJson(STATS_FILE, {});
  pendingActions = loadJson(PENDING_FILE, []);
}
const saveMemoryToDisk = () => {
  const data = {};
  for (const [threadID, value] of memory.entries()) {
    data[threadID] = { messages: (value.messages || []).slice(-MAX_MESSAGES), session: value.session || null };
  }
  saveJson(MEMORY_FILE, data);
};
const saveStats = () => saveJson(STATS_FILE, groupStats);
const savePending = () => saveJson(PENDING_FILE, pendingActions);

// ---------- proactive error alert ----------
function notifyOwners(text) {
  console.error("[GroupAI ALERT]", text);
  if (!cachedApi || typeof cachedApi.sendMessage !== "function") return;
  for (const ownerID of OWNERS) {
    try { cachedApi.sendMessage(text, ownerID); } catch {}
  }
}
function attachCrashHandlers() {
  if (handlersAttached) return;
  handlersAttached = true;
  process.on("uncaughtException", (err) => {
    notifyOwners(`🔴 বট crash হওয়ার মতো একটা error ধরা পড়েছে:\n\n${err.message}\n\n${String(err.stack || "").slice(0, 800)}`);
  });
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? `${reason.message}\n${String(reason.stack || "").slice(0, 800)}` : String(reason);
    notifyOwners(`🟠 Unhandled rejection ধরা পড়েছে:\n\n${msg}`);
  });
}

// ---------- স্ট্যাটস ----------
function getGroupStats(threadID) {
  if (!groupStats[threadID]) {
    groupStats[threadID] = { totalMessages: 0, startTime: Date.now(), lastMessageTime: Date.now() };
  }
  return groupStats[threadID];
}
function bumpMessageCount(threadID) {
  const s = getGroupStats(threadID);
  s.totalMessages++;
  s.lastMessageTime = Date.now();
  saveStats();
}

// ---------- পেন্ডিং অ্যাকশন ----------
function addPendingAction(action, details) {
  const id = Date.now().toString();
  pendingActions.push({ id, action, details, status: "pending", createdAt: Date.now() });
  savePending();
  return id;
}
function cleanupPending() {
  const cutoff = Date.now() - PENDING_TTL_MS;
  const before = pendingActions.length;
  pendingActions = pendingActions.filter(a => a.status !== "pending" || a.createdAt > cutoff);
  if (pendingActions.length !== before) savePending();
}
function takePendingAction(id, status) {
  cleanupPending();
  const action = pendingActions.find(a => a.id === id && a.status === "pending");
  if (!action) return null;
  action.status = status;
  savePending();
  return action;
}

// ---------- সেশন / মেমরি ----------
function isOwner(uid) { return OWNERS.has(String(uid)); }
function getThread(threadID) {
  const id = String(threadID || "unknown");
  if (!memory.has(id)) memory.set(id, { messages: [], session: null });
  return memory.get(id);
}
function addMessage(threadID, name, body) {
  const thread = getThread(threadID);
  thread.messages.push({ name: String(name || "Owner").slice(0, 100), body: String(body || "").slice(0, 4000), time: Date.now() });
  thread.messages = thread.messages.slice(-MAX_MESSAGES);
  saveMemoryToDisk();
  bumpMessageCount(threadID);
}
function startSession(threadID, ownerID) {
  const thread = getThread(threadID);
  thread.session = { ownerID: String(ownerID), active: true, expiresAt: Date.now() + SESSION_TTL_MS, sensitiveUntil: 0 };
  saveMemoryToDisk();
  return thread.session;
}
function activeSession(threadID, ownerID) {
  const session = getThread(threadID).session;
  if (!session || !session.active || String(session.ownerID) !== String(ownerID)) return null;
  if (Number(session.expiresAt || 0) < Date.now()) {
    session.active = false;
    saveMemoryToDisk();
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

// ---------- পাথ সেফটি ----------
function splitArgs(input) {
  const result = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(String(input || "")))) result.push(match[1] ?? match[2] ?? match[3]);
  return result;
}
function isSensitivePath(input) {
  const segments = String(input).replace(/\\/g, "/").split("/").filter(Boolean).map(s => s.toLowerCase());
  return segments.some(s =>
    SENSITIVE_SEGMENTS.has(s) || s.startsWith(".env.") || s.includes("cookie") ||
    s.includes("appstate") || s.includes("secret") || s.includes("credential") ||
    s.includes("private_key") || s.endsWith(".pem")
  );
}
function assertInsideRoot(candidate) {
  if (candidate !== ROOT && !candidate.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error("শুধু project folder-এর ভেতরের path ব্যবহার করা যাবে");
  }
}
function safePath(input, { allowSensitive = false } = {}) {
  const raw = String(input || "").trim();
  if (!raw || raw.includes("\0")) throw new Error("সঠিক file path দিন");
  if (isSensitivePath(raw) && !allowSensitive) throw new Error("Sensitive file blocked। আগে `.gcai approve sensitive` দিন");
  const fullPath = path.resolve(ROOT, raw);
  assertInsideRoot(fullPath);
  try {
    if (fs.existsSync(fullPath)) {
      assertInsideRoot(fs.realpathSync(fullPath));
    } else {
      let ancestor = path.dirname(fullPath);
      while (!fs.existsSync(ancestor)) {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw new Error("Path resolve করা যায়নি");
        ancestor = parent;
      }
      assertInsideRoot(fs.realpathSync(ancestor));
    }
  } catch {
    throw new Error("Path resolve করা যায়নি");
  }
  return fullPath;
}
function formatTime(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ---------- ফাইল অপারেশন ----------
async function runFileCommand(command, args, session) {
  const allowSensitive = Number(session?.sensitiveUntil || 0) > Date.now();
  const filePath = safePath(args[1] || ".", { allowSensitive });

  if (command === "read" || command === "show") {
    if (!fs.existsSync(filePath)) throw new Error("ফাইল পাওয়া যায়নি");
    const content = await fsp.readFile(filePath, "utf8");
    return `📄 ${path.relative(ROOT, filePath)}\n\n${content.slice(0, 18000)}`;
  }
  if (command === "list" || command === "ls") {
    const entries = await fsp.readdir(filePath, { withFileTypes: true });
    const lines = entries.slice(0, 100).map(e => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`);
    return `📂 ${path.relative(ROOT, filePath) || "."}\n\n${lines.join("\n") || "(empty)"}`;
  }
  if (command === "write") {
    const content = args.slice(2).join(" ");
    if (!content) throw new Error("লেখার content দিন");
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, content, "utf8");
    return `✅ লেখা হয়েছে: ${path.relative(ROOT, filePath)}`;
  }
  if (command === "edit") {
    const raw = args.slice(2).join(" ");
    const sep = raw.indexOf("=>");
    if (sep < 1) throw new Error("Format: edit <file> <old> => <new>");
    const oldText = raw.slice(0, sep).trim();
    const newText = raw.slice(sep + 2).trim();
    const content = await fsp.readFile(filePath, "utf8");
    if (!content.includes(oldText)) throw new Error("পুরনো text পাওয়া যায়নি");
    await fsp.writeFile(filePath, content.replace(oldText, newText), "utf8");
    return `✅ Edit হয়েছে: ${path.relative(ROOT, filePath)}`;
  }
  if (command === "delete") {
    if (String(args[2] || "").toLowerCase() !== "confirm") throw new Error("Delete-এর জন্য শেষে `confirm` লিখুন");
    if (!fs.existsSync(filePath)) throw new Error("ফাইল পাওয়া যায়নি");
    await fsp.rm(filePath, { recursive: false, force: false });
    return `✅ Delete হয়েছে: ${path.relative(ROOT, filePath)}`;
  }
  if (command === "check" || command === "test") {
    if (!fs.existsSync(filePath)) throw new Error("ফাইল পাওয়া যায়নি");
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".js") {
      try {
        await execFileAsync(process.execPath, ["--check", filePath], { cwd: ROOT, timeout: 30000 });
        return `✅ JavaScript syntax ঠিক আছে: ${path.relative(ROOT, filePath)}`;
      } catch (error) {
        return `❌ Syntax error:\n${String(error.stderr || error.message).slice(0, 3000)}`;
      }
    }
    if (ext === ".json") {
      try {
        JSON.parse(await fsp.readFile(filePath, "utf8"));
        return `✅ JSON ঠিক আছে: ${path.relative(ROOT, filePath)}`;
      } catch (error) {
        return `❌ JSON error: ${error.message}`;
      }
    }
    const stat = await fsp.stat(filePath);
    return `✅ File accessible: ${path.relative(ROOT, filePath)} (${stat.size} bytes)`;
  }
  throw new Error("File command: read, write, edit, delete, list, check");
}

// ---------- পাওয়ার অ্যাকশন (approve-এর পরেই রান হয়) ----------
async function executePowerAction(action, details) {
  switch (action) {
    case "install_package": {
      const { stdout } = await execAsync(`npm install ${details.package}`);
      return `✅ প্যাকেজ ইনস্টল হয়েছে: ${details.package}\n${stdout.slice(0, 500)}`;
    }
    case "run_command": {
      const { stdout, stderr } = await execAsync(details.command);
      return `✅ কমান্ড রান হয়েছে:\n${(stdout || stderr || "Success").slice(0, 500)}`;
    }
    case "delete_folder": {
      const targetPath = safePath(details.path, { allowSensitive: true });
      await fsp.rm(targetPath, { recursive: true, force: true });
      return `✅ ফোল্ডার ডিলিট হয়েছে: ${details.path}`;
    }
    case "move_file": {
      const source = safePath(details.source, { allowSensitive: true });
      const dest = safePath(details.destination, { allowSensitive: true });
      await fsp.rename(source, dest);
      return `✅ মুভ হয়েছে: ${details.source} → ${details.destination}`;
    }
    case "create_folder": {
      const targetPath = safePath(details.path, { allowSensitive: true });
      await fsp.mkdir(targetPath, { recursive: true });
      return `✅ ফোল্ডার তৈরি হয়েছে: ${details.path}`;
    }
    case "system_info": {
      return `🖥️ সিস্টেম ইনফো:\nCPU: ${os.cpus()[0]?.model || "unknown"}\nRAM: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB\nPlatform: ${os.platform()}\nUptime: ${formatTime(os.uptime() * 1000)}`;
    }
    default:
      return `❌ অজানা অ্যাকশন: ${action}`;
  }
}
const POWER_COMMANDS = {
  install: "install_package", run: "run_command", delete_folder: "delete_folder",
  move: "move_file", mkdir: "create_folder", sysinfo: "system_info"
};
function buildDetails(command, args) {
  if (command === "install") {
    if (!args[1]) throw new Error("প্যাকেজের নাম দিন");
    return { package: args[1] };
  }
  if (command === "run") {
    const cmd = args.slice(1).join(" ");
    if (!cmd) throw new Error("কমান্ড দিন");
    return { command: cmd };
  }
  if (command === "delete_folder" || command === "mkdir") {
    if (!args[1]) throw new Error("পাথ দিন");
    return { path: args[1] };
  }
  if (command === "move") {
    if (!args[1] || !args[2]) throw new Error("source এবং destination দিন");
    return { source: args[1], destination: args[2] };
  }
  return {};
}

// ---------- গ্রুপ তথ্য (read-only, কোনো action না) ----------
async function fetchGroupInfo(api, threadID) {
  const cached = groupInfoCache.get(threadID);
  if (cached && Date.now() - cached.fetchedAt < GROUP_INFO_CACHE_MS) return cached.data;
  if (!api || typeof api.getThreadInfo !== "function") throw new Error("Facebook API থেকে group info পড়া যাচ্ছে না (bot চালু নেই বা API সাপোর্ট করে না)");
  const info = await new Promise((resolve, reject) => {
    const maybePromise = api.getThreadInfo(threadID, (err, data) => (err ? reject(err) : resolve(data)));
    if (maybePromise && typeof maybePromise.then === "function") maybePromise.then(resolve, reject);
  });
  groupInfoCache.set(threadID, { data: info, fetchedAt: Date.now() });
  return info;
}
function summarizeGroupInfo(info) {
  const members = Array.isArray(info.userInfo) ? info.userInfo : [];
  const adminIDs = new Set((info.adminIDs || []).map(a => String(a.id)));
  const names = members.slice(0, 40).map(m => `${adminIDs.has(String(m.id)) ? "👑 " : "• "}${m.name}`);
  return `👥 গ্রুপের নাম: ${info.threadName || "(নাম নেই)"}\nমোট সদস্য: ${members.length}\nঅ্যাডমিন সংখ্যা: ${adminIDs.size}\n\n${names.join("\n")}${members.length > 40 ? `\n... এবং আরও ${members.length - 40} জন` : ""}`;
}

// ---------- AI প্রশ্নোত্তর ----------
function usableApiKey(value) { return typeof value === "string" && /^[\x21-\x7E]+$/.test(value.trim()); }
async function fetchTextOrJson(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal, headers: { ...(options.headers || {}) } });
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text; // plain-text response — pass through as-is, not lost
  }
}
function extractAssistantText(data) {
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed || /^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) return null;
    return trimmed;
  }
  if (!data || typeof data !== "object") return null;
  const candidates = [
    data.message, data.reply, data.response, data.text,
    data?.data?.message, data?.data?.reply, data?.data?.response,
    data?.choices?.[0]?.message?.content, data?.choices?.[0]?.text,
    data?.data?.choices?.[0]?.message?.content
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
async function askPollinations(systemPrompt, userMessage) {
  // এই repo-র bby.js এ প্রমাণিত/কাজ-করা ফরম্যাট অনুযায়ী (root endpoint, POST, plain বা JSON রেসপন্স)
  const key = String(process.env.POLLINATIONS_API_KEY || "").trim();
  const hasKey = usableApiKey(key);
  const headers = { "Content-Type": "application/json" };
  if (hasKey) headers.Authorization = `Bearer ${key}`;
  const data = await fetchTextOrJson("https://text.pollinations.ai/", {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
      model: process.env.POLLINATIONS_MODEL || "openai",
      private: true
    })
  });
  const text = extractAssistantText(data);
  if (!text) throw new Error("Pollinations returned an empty/invalid response");
  return text;
}
async function askOpenRouter(systemPrompt, userMessage) {
  const key = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!usableApiKey(key)) return null;
  const data = await fetchTextOrJson("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "deepseek/deepseek-r1:free",
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
      temperature: 0.3,
      max_tokens: 1200
    })
  });
  const text = extractAssistantText(data);
  if (!text) throw new Error("OpenRouter returned an empty/invalid response");
  return text;
}
const FALLBACK_REPLIES = [
  "হুম, এই মুহূর্তে ঠিক মাথায় আসছে না — একটু পরে আবার জিজ্ঞেস করবেন?",
  "দুঃখিত, এখন ঠিকভাবে বুঝে উঠতে পারছি না। একটু পরে আবার চেষ্টা করুন।",
  "এই মুহূর্তে উত্তরটা গুছিয়ে দিতে পারছি না। কিছুক্ষণ পর আবার বলুন তো।",
  "একটু ব্যস্ত আছি মনে হচ্ছে ভেতরে ভেতরে — আবার একটু পরে জিজ্ঞেস করবেন প্লিজ।"
];
function pickFallbackReply() {
  return FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
}

async function askAI(systemPrompt, userMessage) {
  const hasOpenRouterKey = usableApiKey(String(process.env.OPENROUTER_API_KEY || ""));

  // key থাকলে OpenRouter আগে try করে (বেশি নির্ভরযোগ্য), না থাকলে Pollinations আগে
  const providers = hasOpenRouterKey
    ? [["OpenRouter", askOpenRouter], ["Pollinations", askPollinations]]
    : [["Pollinations", askPollinations], ["OpenRouter", askOpenRouter]];

  for (const [name, fn] of providers) {
    try {
      const text = await fn(systemPrompt, userMessage);
      if (text) return { text, provider: name };
    } catch (error) {
      console.error(`${name} unavailable:`, error.message);
    }
  }
  // অচেনা থার্ড-পার্টি wrapper — সবচেয়ে শেষ, সবচেয়ে কম-নির্ভরযোগ্য ব্যাকআপ হিসেবে
  try {
    const gemini = require("./gemini");
    if (gemini && typeof gemini.askGemini === "function") {
      const text = await gemini.askGemini(userMessage);
      if (text) return { text, provider: "Gemini" };
    }
  } catch (error) {
    console.error("Gemini unavailable:", error.message);
  }
  return null;
}
function detectLanguage(text) {
  if (/[\u0980-\u09FF]/.test(text)) return "Bangla";
  if (/[\u0900-\u097F]/.test(text)) return "Hindi";
  if (/[^\x00-\x7F]/.test(text)) return "the user's language";
  return "English";
}
function buildSystemPrompt(threadID, groupInfoText) {
  const thread = getThread(threadID);
  const history = thread.messages.slice(-20).map(m => `${m.name}: ${m.body}`).join("\n") || "(no previous conversation)";
  return `You are GroupAI, an owner-only assistant for a Facebook Messenger bot's admin.
Answer in the user's language (${detectLanguage(history)}), be concise (2-5 sentences unless code/detail is asked).
Never claim you performed a file/server action — only the explicit commands (read/write/edit/delete/run/install etc.) actually do that.
If asked to fix code, explain the fix and show it in a code block, but tell the user to apply it with the real edit/write command themselves.
${groupInfoText ? `Known group info:\n${groupInfoText}\n` : ""}Recent conversation:
${history}`;
}

// ---------- সাধারণ কথাবার্তা / fallback ----------
async function handleGeneralQuestion(input, context) {
  const threadID = String(context.event.threadID);
  const lower = input.toLowerCase();

  // "ফাইলটা ঠিক করো/সংশোধন করো" জাতীয় স্বাভাবিক বাক্য ধরা এবং নিজে থেকেই fix + test করা
  if (FIX_KEYWORDS.test(input)) {
    const mentionedFile = findMentionedFile(input);
    if (mentionedFile) {
      try {
        return await autoFixFile(mentionedFile, input);
      } catch (error) {
        return `❌ ${error.message}`;
      }
    }
    return "কোন ফাইলটা ঠিক করতে হবে, নামটা লিখে দিন (যেমন: .gcai Goat.js এ এই সমস্যাটা ঠিক করো)।";
  }

  const asksAboutGroup = /(গ্রুপ|group|সদস্য|member|এডমিন|admin)/i.test(input);

  let groupInfoText = "";
  if (asksAboutGroup) {
    try {
      const info = await fetchGroupInfo(context.api, threadID);
      groupInfoText = summarizeGroupInfo(info);
      if (/(কতজন|কত সদস্য|member count|কারা আছে|list)/i.test(lower)) {
        return groupInfoText;
      }
    } catch (error) {
      groupInfoText = `(group info fetch করা যায়নি: ${error.message})`;
    }
  }

  if (["hi", "hello", "হাই", "হ্যালো", "সালাম"].some(w => lower.includes(w)) && input.trim().length < 20) {
    return `👋 হ্যালো! জিজ্ঞেস করুন যা খুশি — গ্রুপ সম্পর্কে, ফাইল সম্পর্কে, বা সাধারণ প্রশ্ন। সব কমান্ড: .gcai help`;
  }
  if (lower.includes("স্ট্যাটস") || lower.includes("কত মেসেজ") || lower.includes("কতটি মেসেজ")) {
    return statsMessage(threadID);
  }

  const result = await askAI(buildSystemPrompt(threadID, groupInfoText), input);
  if (!result) {
    return pickFallbackReply();
  }
  return result.text;
}

// ---------- স্বয়ংক্রিয় ফাইল সংশোধন + টেস্ট (approval ছাড়াই, backup সহ) ----------
const FIX_KEYWORDS = /(ঠিক করো|ঠিক কর|সংশোধন|ফিক্স|fix|রিপেয়ার|সমাধান করো|কাজ করছে না|লোড.*না|লুট.*না|কেন.*না|error|এরর|বাগ|bug)/i;

function findMentionedFile(text) {
  const tokens = String(text || "").split(/\s+/);
  for (const raw of tokens) {
    const token = raw.replace(/^["'(]+/, "").replace(/[.,!?)"']+$/, "");
    if (/\.(js|json|md|txt|html|css|ts|env)$/i.test(token) && !isSensitivePath(token)) {
      try {
        const p = safePath(token, { allowSensitive: false });
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return token;
      } catch { /* not a real/safe path, ignore */ }
    }
  }
  return null;
}

async function testFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".js") {
    await execFileAsync(process.execPath, ["--check", filePath], { cwd: ROOT, timeout: 30000 });
    return "✅ JavaScript syntax ঠিক আছে";
  }
  if (ext === ".json") {
    JSON.parse(await fsp.readFile(filePath, "utf8"));
    return "✅ JSON ভ্যালিড";
  }
  return "ℹ️ এই ফাইল টাইপের জন্য স্বয়ংক্রিয় টেস্ট নেই";
}

async function autoFixFile(targetToken, instruction) {
  const filePath = safePath(targetToken, { allowSensitive: false });
  if (!fs.existsSync(filePath)) throw new Error(`ফাইল পাওয়া যায়নি: ${targetToken}`);
  const original = await fsp.readFile(filePath, "utf8");
  const ext = path.extname(filePath).toLowerCase();

  const prompt = `Owner instruction: "${instruction}"
File: ${targetToken}
Fix the problem described above in this file. Return ONLY the complete corrected file content — no explanation, no markdown code fences, nothing else.
--- FILE CONTENT START ---
${original.slice(0, 14000)}
--- FILE CONTENT END ---`;

  const result = await askAI("You are a precise code-fixing engine. Output only the raw corrected file content, nothing before or after it.", prompt);
  if (!result || !result.text) throw new Error("AI সাময়িকভাবে fix দিতে পারছে না (সব provider fail করেছে)");

  let fixed = result.text.trim().replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  if (!fixed) throw new Error("AI খালি রেসপন্স দিয়েছে, ফাইল বদলানো হয়নি");

  const backupPath = `${filePath}.bak`;
  await fsp.writeFile(backupPath, original, "utf8");
  await fsp.writeFile(filePath, fixed, "utf8");

  try {
    const testResult = await testFile(filePath);
    return `✅ ${targetToken} সংশোধন করা হয়েছে এবং টেস্ট পাশ করেছে।\n${testResult}\n\nপুরনো ভার্সন সেভ আছে — সমস্যা মনে হলে: .gcai revert ${targetToken}`;
  } catch (error) {
    await fsp.writeFile(filePath, original, "utf8");
    await fsp.rm(backupPath, { force: true }).catch(() => {});
    return `❌ সংশোধনের পর টেস্ট ফেল করেছে, তাই আগের ভার্সনে ফিরিয়ে নেওয়া হয়েছে (আপনাকে কিছু করতে হয়নি)।\n\nকারণ:\n${String(error.stderr || error.message).slice(0, 2000)}`;
  }
}

function statsMessage(threadID) {
  const stats = getGroupStats(threadID);
  const running = Date.now() - stats.startTime;
  const lastMsg = stats.lastMessageTime > 0 ? formatTime(Date.now() - stats.lastMessageTime) : "N/A";
  return `📊 গ্রুপ মেসেজ স্ট্যাটস\n\n📝 মোট মেসেজ: ${stats.totalMessages}\n⏱️ চলমান সময়: ${formatTime(running)}\n🕐 শেষ মেসেজ: ${lastMsg} আগে\n📅 শুরু: ${new Date(stats.startTime).toLocaleString()}\n\nরিসেট: .gcai stats reset`;
}

function helpMessage() {
  return `👑 GroupAI v6 — Owner Only

শুরু: .gcai <প্রশ্ন> | বন্ধ: .gcai stop
শুরুর পর ৩০ মিনিট বিনা কমান্ডে সরাসরি কথা বলা যাবে।

🧠 AI প্রশ্নোত্তর: যেকোনো প্রশ্ন লিখুন (সাধারণ প্রশ্ন, গ্রুপ সম্পর্কে, কোড সম্পর্কে)
👥 group / গ্রুপ তথ্য: "group info" লিখুন বা এমনি "গ্রুপে কতজন সদস্য" জিজ্ঞেস করুন

🛠️ স্বাভাবিক ভাষায় ফাইল ঠিক করতে বলুন:
  ".gcai Goat.js ঠিক করো, লোড হচ্ছে না কেন দেখো" — নিজে থেকেই পড়বে, ঠিক করবে, টেস্ট করবে
  টেস্ট ফেল করলে নিজে থেকেই আগের ভার্সনে ফিরিয়ে নেবে
  ভুল মনে হলে ম্যানুয়ালি ফেরাতে: revert <file>

📁 ফাইল (সরাসরি, approval লাগে না):
  read <path> | write <path> <content> | edit <path> <old> => <new>
  delete <path> confirm | list [path] | check <path> (syntax টেস্ট)

⚡ পাওয়ার অ্যাকশন (owner approve করার পরই রান হয়):
  install <package> | run <command> | delete_folder <path>
  move <source> <dest> | mkdir <path> | sysinfo

🔒 অনুমোদন: approve <id> | reject <id> | pending
   approve sensitive | revoke sensitive (sensitive ফাইলের জন্য, ১০ মিনিট)

📊 stats | stats reset

🔴 বট crash করলে/error হলে এই ID গুলোকে নিজে থেকে মেসেজ পাঠাবে।
Owners: ${[...OWNERS].join(", ")}`;
}

// ---------- মেইন হ্যান্ডলার ----------
async function handleInput(context, rawInput, { starting = false } = {}) {
  const threadID = String(context.event.threadID);
  const senderID = String(context.event.senderID);
  if (!isOwner(senderID)) return null;

  const session = starting ? startSession(threadID, senderID) : activeSession(threadID, senderID);
  if (!session) return null;

  const input = String(rawInput || "").trim();
  if (!input) return helpMessage();

  const args = splitArgs(input);
  const command = String(args[0] || "").toLowerCase();
  addMessage(threadID, context.senderName || "Owner", input);
  cleanupPending();

  try {
    if (command === "approve" && args[1] && !isNaN(args[1])) {
      const action = takePendingAction(args[1], "approved");
      if (!action) return "❌ কোনো pending অ্যাকশন পাওয়া যায়নি (মেয়াদ শেষ হয়ে থাকতে পারে)";
      const result = await executePowerAction(action.action, action.details);
      return `✅ অনুমোদিত: ${action.action}\n\n${result}`;
    }
    if (command === "reject" && args[1] && !isNaN(args[1])) {
      const action = takePendingAction(args[1], "rejected");
      return action ? `❌ বাতিল: ${action.action}` : "❌ কোনো pending অ্যাকশন পাওয়া যায়নি";
    }
    if (command === "pending") {
      const pending = pendingActions.filter(a => a.status === "pending");
      if (!pending.length) return "✅ কোনো pending অ্যাকশন নেই";
      return "⏳ Pending:\n\n" + pending.map((a, i) => `${i + 1}. ID: ${a.id} | ${a.action}\n   ${JSON.stringify(a.details)}`).join("\n\n") +
        "\n\nঅনুমোদন: .gcai approve <id> | বাতিল: .gcai reject <id>";
    }
    if (command === "stats") {
      if (String(args[1] || "").toLowerCase() === "reset") {
        groupStats[threadID] = { totalMessages: 0, startTime: Date.now(), lastMessageTime: Date.now() };
        saveStats();
        return "✅ মেসেজ কাউন্ট রিসেট!";
      }
      return statsMessage(threadID);
    }
    if (command === "revert") {
      if (!args[1]) throw new Error("কোন ফাইল revert করতে হবে বলুন: .gcai revert <file>");
      const filePath = safePath(args[1], { allowSensitive: true });
      const backupPath = `${filePath}.bak`;
      if (!fs.existsSync(backupPath)) throw new Error("এই ফাইলের কোনো backup পাওয়া যায়নি");
      await fsp.copyFile(backupPath, filePath);
      return `✅ ${args[1]} আগের ভার্সনে ফিরিয়ে নেওয়া হয়েছে`;
    }
    if (command === "group" || command === "গ্রুপ") {
      const info = await fetchGroupInfo(context.api, threadID);
      return summarizeGroupInfo(info);
    }
    if (command === "stop") {
      session.active = false;
      saveMemoryToDisk();
      return "✅ GroupAI session বন্ধ";
    }
    if (["help", "h", "?"].includes(command)) return helpMessage();
    if (command === "approve" && String(args[1]).toLowerCase() === "sensitive") {
      session.sensitiveUntil = Date.now() + SENSITIVE_APPROVAL_MS;
      saveMemoryToDisk();
      return "⚠️ Sensitive file access ১০ মিনিটের জন্য খোলা";
    }
    if (command === "revoke" && String(args[1]).toLowerCase() === "sensitive") {
      session.sensitiveUntil = 0;
      saveMemoryToDisk();
      return "🔒 Sensitive file access বন্ধ";
    }
    if (command in POWER_COMMANDS) {
      const details = buildDetails(command, args);
      const id = addPendingAction(POWER_COMMANDS[command], details);
      return `⚠️ অনুমতি প্রয়োজন\n\n📌 অ্যাকশন: ${POWER_COMMANDS[command]}\n📝 বিবরণ: ${JSON.stringify(details)}\n🆔 ID: ${id}\n\nঅনুমোদন: .gcai approve ${id}\nবাতিল: .gcai reject ${id}\n⏳ ৫ মিনিটের মধ্যে মেয়াদ শেষ হবে`;
    }
    if (["read", "show", "write", "edit", "delete", "list", "ls", "check", "test"].includes(command)) {
      const response = await runFileCommand(command, args, session);
      addMessage(threadID, "GroupAI", response);
      return response;
    }
  } catch (error) {
    return `❌ ${error.message}`;
  }

  const response = await handleGeneralQuestion(input, context);
  addMessage(threadID, "GroupAI", response);
  return response;
}

loadAll();

function isCommandBody(body) {
  return /^\s*\.(?:gcai|groupai)(?:\s|$)/i.test(String(body || ""));
}

module.exports = {
  config: {
    name: "gcai",
    aliases: ["groupai"],
    version: "6.0.0",
    author: "System",
    countDown: 3,
    role: 0,
    shortDescription: { bn: "👑 AI অ্যাসিস্ট্যান্ট + গ্রুপ তথ্য + ফাইল ম্যানেজমেন্ট", en: "👑 AI assistant + group info + file management" },
    category: "AI/Development",
    guide: { bn: ".gcai <প্রশ্ন>", en: ".gcai <question>" }
  },

  onStart: async function ({ api, event, args, message, usersData }) {
    cachedApi = api;
    attachCrashHandlers();
    const senderID = String(event.senderID);
    if (!isOwner(senderID)) return;
    let senderName = "Owner";
    try { if (usersData?.getName) senderName = (await usersData.getName(senderID)) || "Owner"; } catch {}
    try {
      const response = await handleInput({ api, event, message, usersData, senderName }, args.join(" "), { starting: true });
      if (response) return message.reply(response);
    } catch (error) {
      console.error("GroupAI error:", error.message);
      return message.reply(`❌ ${error.message}`);
    }
  },

  onChat: async function ({ api, event, message, usersData }) {
    cachedApi = api;
    attachCrashHandlers();
    const senderID = String(event.senderID);
    if (!isOwner(senderID)) return;
    const body = String(event.body || "").trim();
    if (!body || isCommandBody(body)) return;
    const session = getThread(event.threadID).session;
    if (!session || !session.active || String(session.ownerID) !== senderID) return;
    let senderName = "Owner";
    try { if (usersData?.getName) senderName = (await usersData.getName(senderID)) || "Owner"; } catch {}
    try {
      const response = await handleInput({ api, event, message, usersData, senderName }, body);
      if (response) return message.reply(response);
    } catch (error) {
      console.error("GroupAI follow-up error:", error.message);
      return message.reply(`❌ ${error.message}`);
    }
  }
};
