/**
 * GroupAI core.
 *
 * Safety contract:
 * - Only the two configured owners can use this command.
 * - Only an explicit `.gcai`/`.groupai` command starts a conversation.
 * - Follow-up messages work only inside an active owner session.
 * - AI can explain and suggest, but never chooses or executes an action.
 * - Sensitive files require a short-lived, explicit owner approval.
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const OWNERS = new Set(["61576355017916", "100082814982394"]);
const MAX_MESSAGES = 200;
const SESSION_TTL_MS = 30 * 60 * 1000;
const SENSITIVE_APPROVAL_MS = 10 * 60 * 1000;
const MEMORY_FILE = path.join(__dirname, "cache", "groupai_memory.json");

const memory = new Map();

const SENSITIVE_SEGMENTS = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "account.txt",
  "cookies.json",
  "cookies.js",
  "appstate.json",
  "token.txt",
  "credentials.json",
  "config.json",
  ".npmrc",
  "id_rsa"
]);

function isOwner(uid) {
  return OWNERS.has(String(uid));
}

function loadMemory() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return;
    const stored = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
    for (const [threadID, value] of Object.entries(stored)) {
      memory.set(threadID, {
        messages: Array.isArray(value.messages) ? value.messages.slice(-MAX_MESSAGES) : [],
        session: value.session && typeof value.session === "object" ? value.session : null
      });
    }
  } catch (error) {
    console.error("GroupAI memory load error:", error.message);
  }
}

function saveMemory() {
  try {
    fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
    const data = {};
    for (const [threadID, value] of memory.entries()) {
      data[threadID] = {
        messages: (value.messages || []).slice(-MAX_MESSAGES),
        session: value.session || null
      };
    }
    const temporary = `${MEMORY_FILE}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, MEMORY_FILE);
  } catch (error) {
    console.error("GroupAI memory save error:", error.message);
  }
}

function getThread(threadID) {
  const id = String(threadID || "unknown");
  if (!memory.has(id)) memory.set(id, { messages: [], session: null });
  return memory.get(id);
}

function addMessage(threadID, name, body) {
  const thread = getThread(threadID);
  thread.messages.push({
    name: String(name || "Owner").slice(0, 100),
    body: String(body || "").slice(0, 4000),
    time: Date.now()
  });
  thread.messages = thread.messages.slice(-MAX_MESSAGES);
  saveMemory();
}

function startSession(threadID, ownerID) {
  const thread = getThread(threadID);
  const current = thread.session || {};
  thread.session = {
    ownerID: String(ownerID),
    active: true,
    expiresAt: Date.now() + SESSION_TTL_MS,
    sensitiveUntil: Number(current.sensitiveUntil || 0),
    selfMessageUntil: Number(current.selfMessageUntil || 0),
    pending: null
  };
  saveMemory();
  return thread.session;
}

function activeSession(threadID, ownerID) {
  const thread = getThread(threadID);
  const session = thread.session;
  if (!session || !session.active || String(session.ownerID) !== String(ownerID)) return null;
  if (Number(session.expiresAt || 0) < Date.now()) {
    session.active = false;
    session.pending = null;
    saveMemory();
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function splitArgs(input) {
  const result = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(String(input || "")))) {
    result.push(match[1] ?? match[2] ?? match[3]);
  }
  return result;
}

function isSensitivePath(input) {
  const segments = String(input)
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map(item => item.toLowerCase());
  return segments.some(segment =>
    SENSITIVE_SEGMENTS.has(segment) ||
    segment.startsWith(".env.") ||
    segment.includes("cookie") ||
    segment.includes("appstate") ||
    segment.includes("secret") ||
    segment.includes("credential") ||
    segment.includes("private_key") ||
    segment.endsWith(".pem")
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
  if (isSensitivePath(raw) && !allowSensitive) {
    throw new Error("Sensitive file blocked। আগে `.gcai approve sensitive` দিন");
  }

  const fullPath = path.resolve(ROOT, raw);
  assertInsideRoot(fullPath);

  try {
    // New files may be placed in a new directory. Resolve the nearest
    // existing ancestor instead of requiring every parent to exist already.
    // This still rejects symlinks that escape the project root.
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

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days && `${days}d`, hours && `${hours}h`, `${minutes}m`].filter(Boolean).join(" ");
}

function detectLanguage(text) {
  if (/[\u0980-\u09FF]/.test(text)) return "Bangla";
  if (/[\u0900-\u097F]/.test(text)) return "Hindi";
  if (/[\u0600-\u06FF]/.test(text)) return "Arabic/Urdu";
  if (/[^\x00-\x7F]/.test(text)) return "the user's language";
  return "English";
}

async function fetchJson(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 1000) };
  }
  if (!response.ok) {
    const message = data?.message || data?.error || `HTTP ${response.status}`;
    throw new Error(String(message).slice(0, 300));
  }
  return data;
}

async function askOpenRouter(systemPrompt, userMessage) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const data = await fetchJson("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://replit.com",
      "X-Title": "GoatBot GroupAI"
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      temperature: 0.2,
      max_tokens: 1200
    })
  });
  return data?.choices?.[0]?.message?.content || null;
}

async function askPollinations(systemPrompt, userMessage) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.POLLINATIONS_API_KEY) {
    headers.Authorization = `Bearer ${process.env.POLLINATIONS_API_KEY}`;
  }
  const data = await fetchJson("https://text.pollinations.ai/", {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      model: process.env.POLLINATIONS_MODEL || "openai",
      private: true
    })
  });
  return data?.choices?.[0]?.message?.content || data?.response || null;
}

async function askAI(systemPrompt, userMessage) {
  try {
    const primary = await askOpenRouter(systemPrompt, userMessage);
    if (primary) return { text: primary, provider: "OpenRouter" };
  } catch (error) {
    console.error("OpenRouter unavailable:", error.message);
  }
  try {
    const backup = await askPollinations(systemPrompt, userMessage);
    if (backup) return { text: backup, provider: "Pollinations.ai" };
  } catch (error) {
    console.error("Pollinations unavailable:", error.message);
  }
  return null;
}

function getFacebookApi(context) {
  return context.api || global.GoatBot?.fcaApi || global.api || null;
}

function callFacebookApi(api, method, args = []) {
  const fn = api?.[method];
  if (typeof fn !== "function") {
    throw new Error(`${method} API available নয়`);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve(value);
    };
    const callback = (error, value) => finish(error, value);

    try {
      const result = fn.call(api, ...args, callback);
      if (result && typeof result.then === "function") {
        result.then(value => finish(null, value), error => finish(error));
      } else if (result !== undefined || fn.length <= args.length) {
        // Promise-returning and synchronous clients do not need the callback.
        finish(null, result);
      }
    } catch (error) {
      finish(error);
    }

    setTimeout(() => {
      if (!settled) finish(new Error(`${method} API timeout`));
    }, 30000).unref?.();
  });
}

function currentUserID(api) {
  if (typeof api?.getCurrentUserID === "function") return String(api.getCurrentUserID());
  return String(global.GoatBot?.botID || "");
}

function githubRepoParts(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(?:https?:\/\/github\.com\/)?([^/\s]+)\/([^/\s?#]+)$/i);
  if (!match) throw new Error("GitHub repo format: owner/repo বা https://github.com/owner/repo");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

async function githubRequest(repoValue, filePath) {
  const { owner, repo } = githubRepoParts(repoValue);
  let endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`;
  if (filePath) {
    const encoded = String(filePath).split("/").map(encodeURIComponent).join("/");
    endpoint += `/${encoded}`;
  }
  const data = await fetchJson(endpoint, {
    headers: { "User-Agent": "GoatBot-GroupAI", Accept: "application/vnd.github+json" }
  });
  return { owner, repo, data };
}

function helpMessage() {
  return `👑 GroupAI / GCAI — Owner Only

শুরু: .gcai <প্রশ্ন>
তারপর একই thread-এ ৩০ মিনিট command ছাড়াই কথা বলা যাবে।
বন্ধ: .gcai stop

File: read, write, edit, delete confirm, list, check
Sensitive file: .gcai approve sensitive / .gcai revoke sensitive
GitHub: github owner/repo [path]
Facebook: fb post, like, comment, read, info, message
Permission: approve sensitive | permission self on/off
Analysis: status, analyze, predict, problems, solve

AI কোনো action নিজে চালায় না; file/FB/GitHub কাজ explicit request-এ হয়।
Owners: ${[...OWNERS].join(", ")}`;
}

async function runFileCommand(command, args, session) {
  const allowSensitive = Number(session?.sensitiveUntil || 0) > Date.now();
  const requested = command === "list" || command === "ls" ? (args[1] || ".") : args[1];
  const filePath = safePath(requested, { allowSensitive });

  if (command === "read") {
    if (!fs.existsSync(filePath)) throw new Error("ফাইল পাওয়া যায়নি");
    const content = await fsp.readFile(filePath, "utf8");
    return `📄 ${path.relative(ROOT, filePath) || "."}\n\n${content.slice(0, 18000)}`;
  }

  if (command === "list" || command === "ls") {
    const entries = await fsp.readdir(filePath, { withFileTypes: true });
    const lines = entries.slice(0, 100).map(entry => `${entry.isDirectory() ? "📁" : "📄"} ${entry.name}`);
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
    const separator = raw.indexOf("=>");
    if (separator < 1) throw new Error("Format: edit <file> <old> => <new>");
    const oldText = raw.slice(0, separator).trim();
    const newText = raw.slice(separator + 2).trim();
    const content = await fsp.readFile(filePath, "utf8");
    const matches = content.split(oldText).length - 1;
    if (matches === 0) throw new Error("পুরনো text পাওয়া যায়নি");
    if (matches > 1) throw new Error("পুরনো text একাধিকবার আছে; edit আরও নির্দিষ্ট করুন");
    await fsp.writeFile(filePath, content.replace(oldText, newText), "utf8");
    return `✅ Edit হয়েছে: ${path.relative(ROOT, filePath)}`;
  }

  if (command === "delete") {
    if (String(args[2] || "").toLowerCase() !== "confirm") {
      throw new Error("Delete-এর জন্য শেষে `confirm` লিখুন");
    }
    if (!fs.existsSync(filePath)) throw new Error("ফাইল পাওয়া যায়নি");
    await fsp.rm(filePath, { recursive: false, force: false });
    return `✅ Delete হয়েছে: ${path.relative(ROOT, filePath)}`;
  }

  if (command === "check" || command === "test") {
    if (!fs.existsSync(filePath)) throw new Error("ফাইল পাওয়া যায়নি");
    if (path.extname(filePath).toLowerCase() === ".js") {
      try {
        await execFileAsync(process.execPath, ["--check", filePath], { cwd: ROOT, timeout: 30000 });
        return `✅ JavaScript syntax ঠিক আছে: ${path.relative(ROOT, filePath)}`;
      } catch (error) {
        return `❌ Syntax error:\n${String(error.stderr || error.message).slice(0, 4000)}`;
      }
    }
    if (path.extname(filePath).toLowerCase() === ".json") {
      JSON.parse(await fsp.readFile(filePath, "utf8"));
      return `✅ JSON ঠিক আছে: ${path.relative(ROOT, filePath)}`;
    }
    const stat = await fsp.stat(filePath);
    return `✅ File accessible: ${path.relative(ROOT, filePath)} (${stat.size} bytes)`;
  }

  throw new Error("File command: read, write, edit, delete, list, check");
}

async function runFacebookCommand(args, context, session) {
  const api = getFacebookApi(context);
  if (!api) throw new Error("Facebook API initialized নয়");
  const subcommand = String(args[1] || "").toLowerCase();

  if (subcommand === "post") {
    const visibility = String(args[2] || "").toLowerCase();
    const content = ["public", "private"].includes(visibility)
      ? args.slice(3).join(" ")
      : args.slice(2).join(" ");
    if (!content) throw new Error("Post text দিন");
    if (!["public", "private"].includes(visibility)) {
      session.pending = { type: "facebook-post", content, expiresAt: Date.now() + 5 * 60 * 1000 };
      saveMemory();
      return "Post public হবে নাকি private? শুধু `public` বা `private` লিখুন।";
    }
    if (typeof api.createPost !== "function" && typeof api.post !== "function") {
      throw new Error("এই FCA client-এ profile post API নেই; message API-কে post বলে ভান করা হবে না।");
    }
    const payload = { body: content, privacy: visibility === "public" ? "EVERYONE" : "SELF" };
    const result = typeof api.createPost === "function"
      ? await callFacebookApi(api, "createPost", [payload])
      : await callFacebookApi(api, "post", [payload]);
    return `✅ Facebook ${visibility} post পাঠানো হয়েছে${result?.id ? `: ${result.id}` : ""}`;
  }

  if (subcommand === "like") {
    if (!args[2]) throw new Error("Message/post ID দিন");
    await callFacebookApi(api, "setMessageReaction", ["👍", args[2]]);
    return `✅ Like দেওয়া হয়েছে: ${args[2]}`;
  }

  if (subcommand === "comment") {
    const target = args[2];
    const text = args.slice(3).join(" ");
    if (!target || !text) throw new Error("Target thread/message ID এবং comment দিন");
    await callFacebookApi(api, "sendMessage", [text, target]);
    return "✅ Comment/message পাঠানো হয়েছে";
  }

  if (subcommand === "read") {
    const threadID = args[2];
    const limit = Math.min(Math.max(Number(args[3]) || 10, 1), 50);
    if (!threadID) throw new Error("Thread ID দিন");
    const messages = await callFacebookApi(api, "getThreadHistory", [threadID, limit]);
    return `📖 ${threadID}\n\n${(messages || []).slice(0, limit)
      .map(item => `• ${item.senderName || item.senderID || ""}: ${item.body || "[attachment]"}`)
      .join("\n") || "(কোনো message নেই)"}`;
  }

  if (subcommand === "info") {
    const uid = args[2] || currentUserID(api);
    const info = await callFacebookApi(api, "getUserInfo", [uid]);
    const user = info?.[uid];
    return user ? `👤 ${user.name || "Unknown"}\nUID: ${uid}` : "User পাওয়া যায়নি";
  }

  if (subcommand === "message" || subcommand === "send") {
    if (Number(session?.selfMessageUntil || 0) < Date.now()) {
      throw new Error("নিজে message করার permission নেই। `.gcai permission self on` দিন।");
    }
    const target = args[2];
    const text = args.slice(3).join(" ");
    if (!target || !text) throw new Error("Target thread ID এবং message দিন");
    await callFacebookApi(api, "sendMessage", [text, target]);
    return "✅ Owner permission অনুযায়ী message পাঠানো হয়েছে";
  }

  if (subcommand === "avatar" || subcommand === "profile") {
    const filePath = safePath(args[2], { allowSensitive: false });
    await callFacebookApi(api, "changeAvatar", [filePath]);
    return "✅ Profile picture update request পাঠানো হয়েছে";
  }

  if (subcommand === "cover") {
    throw new Error("এই FCA client-এ cover photo API নেই");
  }

  throw new Error("FB command: post, like, comment, read, info, message, avatar, cover");
}

async function diagnostics(mode) {
  const usage = process.memoryUsage();
  const commandDir = path.join(ROOT, "scripts", "cmds");
  const commandCount = fs.existsSync(commandDir)
    ? fs.readdirSync(commandDir).filter(item => item.endsWith(".js")).length
    : 0;
  const problems = [];
  if (!fs.existsSync(commandDir)) problems.push("scripts/cmds folder পাওয়া যায়নি");
  if (!process.env.OPENROUTER_API_KEY && !process.env.POLLINATIONS_API_KEY) {
    problems.push("AI key/config পাওয়া যায়নি; Pollinations public fallback চেষ্টা হবে");
  }
  if (usage.heapUsed / usage.heapTotal > 0.8) problems.push("Heap usage 80%+");
  const base = `Node ${process.version} | ${process.platform}
Commands: ${commandCount}
Heap: ${(usage.heapUsed / 1024 / 1024).toFixed(1)} / ${(usage.heapTotal / 1024 / 1024).toFixed(1)} MB
Uptime: ${formatUptime(process.uptime())}
Memory threads: ${memory.size} (up to ${MAX_MESSAGES} messages/thread)
AI: ${process.env.OPENROUTER_API_KEY ? "OpenRouter ready" : "OpenRouter key missing"} → Pollinations backup`;
  if (mode === "problems") return problems.length ? `⚠️ Problems:\n• ${problems.join("\n• ")}` : "✅ কোনো সমস্যা পাওয়া যায়নি";
  if (mode === "predict") {
    const ratio = usage.heapUsed / usage.heapTotal;
    return `${ratio > 0.8 ? "⚠️" : "✅"} Heap projection: ${(ratio * 100).toFixed(1)}% used`;
  }
  return base;
}

function systemPrompt(threadID) {
  const thread = getThread(threadID);
  const history = thread.messages.slice(-20)
    .map(item => `${item.name}: ${item.body}`)
    .join("\n") || "(no previous conversation)";
  return `You are GroupAI, a cautious owner-only assistant.
Answer in the user's language (${detectLanguage(history)}).
Never claim that a file, Facebook, or GitHub action happened unless the deterministic command handler confirms it.
Never invent credentials, cookies, tokens, file contents, or API results.
Explain that explicit commands are required for side effects; do not output executable instructions that bypass Owner protection.
Be concise and useful.
Recent conversation:
${history}`;
}

function naturalAction(input) {
  const text = String(input || "").trim();
  const lower = text.toLowerCase();
  if (/^(stop|বন্ধ|থামো)$/i.test(text)) return ["stop"];
  if (/^(status|analyze|analysis|স্ট্যাটাস|অ্যানালাইজ)/i.test(text)) return ["status"];
  if (/^(predict|প্রেডিক্ট)/i.test(text)) return ["predict"];
  if (/^(problems|problem|issue|সমস্যা)/i.test(text)) return ["problems"];
  if (/^(list files|show files|ফাইল দেখাও|ফাইল লিস্ট)/i.test(lower)) return ["list", "."];
  const tokens = splitArgs(text);
  const readCommands = new Set(["read", "show", "open", "পড়ো", "পড়ো", "দেখাও"]);
  if (readCommands.has(String(tokens[0] || "").toLowerCase())) {
    const pathStart = String(tokens[1] || "").toLowerCase() === "file" ? 2 : 1;
    if (tokens[pathStart]) return ["read", tokens.slice(pathStart).join(" ")];
  }
  return null;
}

async function handleInput(context, rawInput, { starting = false } = {}) {
  const threadID = String(context.event.threadID);
  const senderID = String(context.event.senderID);
  if (!isOwner(senderID)) return null;
  const session = starting ? startSession(threadID, senderID) : activeSession(threadID, senderID);
  if (!session) return null;

  let input = String(rawInput || "").trim();
  if (!input) return helpMessage();
  const thread = getThread(threadID);

  if (session.pending?.type === "facebook-post") {
    const choice = input.toLowerCase();
    if (choice === "cancel" || choice === "বাতিল") {
      session.pending = null;
      saveMemory();
      return "❎ Pending post বাতিল হয়েছে";
    }
    if (choice !== "public" && choice !== "private") return "শুধু `public`, `private`, অথবা `cancel` লিখুন।";
    const post = session.pending;
    session.pending = null;
    const response = await runFacebookCommand(["fb", "post", choice, post.content], context, session);
    saveMemory();
    return response;
  }

  const natural = naturalAction(input);
  const args = splitArgs(input);
  const command = String((natural || args)[0] || "").toLowerCase();
  const commandArgs = natural || args;
  addMessage(threadID, context.senderName || "Owner", input);

  if (command === "stop") {
    session.active = false;
    session.pending = null;
    saveMemory();
    return "✅ GroupAI session বন্ধ হয়েছে";
  }
  if (["help", "h", "?"].includes(command)) return helpMessage();
  if (command === "approve" && String(commandArgs[1]).toLowerCase() === "sensitive") {
    session.sensitiveUntil = Date.now() + SENSITIVE_APPROVAL_MS;
    saveMemory();
    return "⚠️ Sensitive file access ১০ মিনিটের জন্য Owner অনুমতিতে খোলা হয়েছে";
  }
  if (command === "revoke" && String(commandArgs[1]).toLowerCase() === "sensitive") {
    session.sensitiveUntil = 0;
    saveMemory();
    return "🔒 Sensitive file access আবার বন্ধ";
  }
  if (command === "permission" && String(commandArgs[1]).toLowerCase() === "self") {
    const value = String(commandArgs[2] || "").toLowerCase();
    if (value === "on") {
      session.selfMessageUntil = Date.now() + SESSION_TTL_MS;
      saveMemory();
      return "✅ এই thread-এর জন্য Owner permission-এ self-message চালু (৩০ মিনিট)";
    }
    if (value === "off") {
      session.selfMessageUntil = 0;
      saveMemory();
      return "🔒 Self-message permission বন্ধ";
    }
    return "Format: permission self on/off";
  }
  if (["read", "write", "edit", "delete", "list", "ls", "check", "test"].includes(command)) {
    const response = await runFileCommand(command, commandArgs, session);
    addMessage(threadID, "GroupAI", response);
    return response;
  }
  if (command === "github" || command === "repo") {
    const result = await githubRequest(commandArgs[1], commandArgs[2]);
    if (Array.isArray(result.data)) {
      return `🐙 ${result.owner}/${result.repo}\n\n${result.data.slice(0, 100)
        .map(item => `${item.type === "dir" ? "📁" : "📄"} ${item.name}`).join("\n")}`;
    }
    const content = result.data.content
      ? Buffer.from(result.data.content.replace(/\n/g, ""), "base64").toString("utf8")
      : JSON.stringify(result.data, null, 2);
    return `📄 ${result.data.path}\n\n${content.slice(0, 18000)}`;
  }
  if (command === "fb" || command === "facebook") {
    const response = await runFacebookCommand(commandArgs, context, session);
    addMessage(threadID, "GroupAI", response);
    return response;
  }
  if (["status", "analyze", "predict", "problems", "issue", "fix", "solve"].includes(command)) {
    if (command === "fix" || command === "solve") {
      return "🔎 আগে `.gcai problems` দিয়ে diagnosis নিন। GroupAI নিজে কোনো file বা account পরিবর্তন করে না; সমাধানের জন্য explicit `write/edit/delete confirm` command দরকার।";
    }
    const response = await diagnostics(command === "predict" ? "predict" : command === "problems" || command === "issue" ? "problems" : "status");
    addMessage(threadID, "GroupAI", response);
    return response;
  }

  const question = input;
  const result = await askAI(systemPrompt(threadID), question);
  const response = result
    ? `${result.text}\n\n— ${result.provider}`
    : "AI service এখন উত্তর দিচ্ছে না। OPENROUTER_API_KEY সেট করুন; তারপর Pollinations backup চেষ্টা হবে।";
  addMessage(threadID, "GroupAI", response);
  return response;
}

loadMemory();

module.exports = {
  OWNERS,
  MAX_MESSAGES,
  isOwner,
  safePath,
  getThread,
  handleInput,
  helpMessage
};