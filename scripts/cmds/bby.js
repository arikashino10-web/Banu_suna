/**
 * bby.js — Advanced Baby / Hinata chat command for GoatBot
 *
 * Combined and hardened from the three implementations in:
 * https://paste.centos.org/view/7a9e5f32
 *
 * Requires:
 *   npm install axios
 *
 * Supported:
 *   bby <message>
 *   bby teach <question> - <reply1>, <reply2>
 *   bby teach react <question> - <reaction1>, <reaction2>
 *   bby teach amar <question> - <reply>
 *   bby remove <question>
 *   bby rm <question> - <index>
 *   bby edit <question> - <new reply>
 *   bby msg <question>
 *   bby list
 *   bby list all [limit]
 *
 * The command keeps the original Ullash/Simsimi-trained database as the
 * primary provider, then falls back to Hinata and Noobs when unavailable.
 */

const axios = require("axios");

const SETTINGS = Object.freeze({
  requestTimeout: 15000,
  cooldownMs: 1200,
  maxReplyLength: 1900,
  maxTeacherRows: 100,
  defaultStyle: 3,
  aliases: [
    "bby",
    "baby",
    "babu",
    "bbu",
    "babe",
    "bbe",
    "jan",
    "janu",
    "wifey",
    "bot",
    "hina",
    "hinata",
    "জান",
    "জানু",
    "বেবি"
  ]
});

const FALLBACK_MESSAGES = [
  "বলো জানু, শুনছি তো? 💗",
  "হুম, আমি এখানে আছি। কী বলবে?",
  "Bolo baby, কী করতে পারি?",
  "এত সুন্দর করে ডাকলে উত্তর না দিয়ে পারি নাকি? 😊",
  "বলো, সবার সামনে বলবে নাকি inbox-এ? 😄",
  "আমি শুনছি—তুমি বলো।"
];

const MEDIA_MESSAGES = {
  photo: [
    "ছবিটা সুন্দর হয়েছে—এটার গল্পটা বলো তো? 📸",
    "ওহ, ছবি পাঠিয়েছ! এটা দেখে কী বলতে হবে? 😊"
  ],
  video: [
    "ভিডিওটা দেখলাম—এর best part কোনটা?",
    "ভিডিও পাঠিয়ে চুপ কেন? কিছু বলো তো! 🎬"
  ],
  audio: [
    "ভয়েস মেসেজ পেলাম—আরেকবার বলবে? 🎧",
    "তোমার voice note শুনলাম, এখন গল্পটা বলো।"
  ],
  sticker: [
    "স্টিকার দিয়ে সব কথা বলা যায় নাকি? 😄",
    "এই স্টিকারটার মানে কী, জানু?"
  ],
  animated_image: [
    "GIF দিয়ে mood বোঝালে, এবার কথায় বলো। 😄",
    "এই animation-টা মজার! কী হয়েছে?"
  ],
  default: [
    "Attachment পেলাম—এটার ব্যাপারে কী বলব?",
    "এটা দেখলাম। একটু explain করো তো?"
  ]
};

const baseCache = {
  legacy: null,
  hinata: null
};

const lastRequestAt = new Map();

module.exports.config = {
  name: "bby",
  aliases: SETTINGS.aliases,
  version: "8.0.0",
  author: "Advanced merge",
  countDown: 2,
  role: 0,
  description: "Advanced Baby AI chat, teaching, replies, reactions and media support",
  category: "chat",
  guide: {
    en: [
      "{pn} <message>",
      "{pn} teach <question> - <reply1>, <reply2>",
      "{pn} teach react <question> - <reaction1>, <reaction2>",
      "{pn} teach amar <question> - <reply>",
      "{pn} remove <question>",
      "{pn} rm <question> - <index>",
      "{pn} edit <question> - <new reply>",
      "{pn} msg <question>",
      "{pn} list",
      "{pn} list all [limit]"
    ].join("\n")
  }
};

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function lower(value) {
  return clean(value).toLocaleLowerCase();
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTrailingSlash(value) {
  return clean(value).replace(/\/+$/, "");
}

function asError(error) {
  return error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    "Unknown API error";
}

function extractText(data) {
  if (typeof data === "string") return clean(data);
  if (!data || typeof data !== "object") return "";

  const candidates = [
    data.message,
    data.reply,
    data.response,
    data.text,
    data.data?.message,
    data.data?.reply,
    data.data?.response
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const text = candidate.map(clean).filter(Boolean).join("\n");
      if (text) return text;
    } else if (clean(candidate)) {
      return clean(candidate);
    }
  }

  return "";
}

function splitReply(text) {
  const value = clean(text);
  if (!value) return ["দুঃখিত, কোনো উত্তর পাওয়া যায়নি।"];

  const chunks = [];
  let remaining = value;
  while (remaining.length > SETTINGS.maxReplyLength) {
    let cut = remaining.lastIndexOf("\n", SETTINGS.maxReplyLength);
    if (cut < SETTINGS.maxReplyLength * 0.55) {
      cut = remaining.lastIndexOf(" ", SETTINGS.maxReplyLength);
    }
    if (cut < SETTINGS.maxReplyLength * 0.55) {
      cut = SETTINGS.maxReplyLength;
    }
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function markReply(info, event, extra = {}) {
  const store = global.GoatBot?.onReply;
  if (!store || typeof store.set !== "function" || !info?.messageID) return;

  store.set(info.messageID, {
    commandName: module.exports.config.name,
    type: "reply",
    messageID: info.messageID,
    author: event.senderID,
    threadID: event.threadID,
    ...extra
  });
}

function sendOne(api, text, event, callback) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (error, info) => {
      if (settled) return;
      settled = true;
      if (typeof callback === "function") callback(error, info);
      resolve({ error, info });
    };

    try {
      const result = api.sendMessage(
        text,
        event.threadID,
        (error, info) => finish(error, info),
        event.messageID
      );

      // A few GoatBot forks return a Promise instead of invoking a callback.
      if (result && typeof result.then === "function") {
        result.then((info) => finish(null, info)).catch((error) => finish(error));
      }
    } catch (error) {
      finish(error);
    }
  });
}

async function sendReply(api, event, text, extra = {}) {
  let lastInfo = null;
  for (const chunk of splitReply(text)) {
    const result = await sendOne(api, chunk, event, (error, info) => {
      if (!error && info) {
        lastInfo = info;
        markReply(info, event, extra);
      }
    });
    if (result.error) throw result.error;
  }
  return lastInfo;
}

function react(api, event, emoji = "💗") {
  try {
    if (typeof api.setMessageReaction === "function") {
      api.setMessageReaction(emoji, event.messageID, () => {}, true);
    }
  } catch (_) {
    // Reactions are optional on some GoatBot adapters.
  }
}

function typing(api, event, enabled = true) {
  try {
    if (typeof api.sendTypingIndicator === "function") {
      api.sendTypingIndicator(event.threadID, enabled);
    }
  } catch (_) {
    // Typing indicators are optional.
  }
}

function checkCooldown(event, scope = "chat") {
  const key = `${scope}:${event.threadID}:${event.senderID}`;
  const now = Date.now();
  const previous = lastRequestAt.get(key) || 0;
  if (now - previous < SETTINGS.cooldownMs) return false;
  lastRequestAt.set(key, now);
  return true;
}

async function getLegacyBase() {
  if (baseCache.legacy) return baseCache.legacy;

  try {
    const response = await axios.get(
      "https://gitlab.com/shahadat-sahu/sahu-api/-/raw/main/API.json",
      { timeout: SETTINGS.requestTimeout }
    );
    const base = stripTrailingSlash(response.data?.simsimi);
    if (base) {
      baseCache.legacy = base;
      return base;
    }
  } catch (_) {
    // Use the known public fallback below.
  }

  return "https://noobs-api.top/dipto";
}

async function getHinataBase() {
  if (baseCache.hinata) return baseCache.hinata;

  try {
    const response = await axios.get(
      "https://raw.githubusercontent.com/mahmudx7/HINATA/main/baseApiUrl.json",
      { timeout: SETTINGS.requestTimeout }
    );
    const base = stripTrailingSlash(response.data?.mahmud);
    if (base) {
      baseCache.hinata = base;
      return base;
    }
  } catch (_) {
    // Use the known public fallback below.
  }

  return "https://noobs-api.top/dipto";
}

async function legacyRequest(params) {
  const base = await getLegacyBase();
  return axios.get(base, {
    params,
    timeout: SETTINGS.requestTimeout
  });
}

async function noobsRequest(params) {
  return axios.get(`${stripTrailingSlash("https://noobs-api.top/dipto")}/baby`, {
    params,
    timeout: SETTINGS.requestTimeout
  });
}

async function hinataRequest(method, path, data, params) {
  const base = await getHinataBase();
  return axios({
    method,
    url: `${base}${path}`,
    data,
    params,
    timeout: SETTINGS.requestTimeout
  });
}

async function firstSuccessful(label, requests) {
  const errors = [];
  for (const request of requests) {
    try {
      const response = await request();
      if (response?.status >= 400) {
        throw new Error(`${label}: HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      errors.push(asError(error));
    }
  }
  throw new Error(`${label} unavailable: ${errors[errors.length - 1] || "unknown error"}`);
}

async function getBotResponse(text, attachments = [], senderID = "") {
  const input = clean(text) || "meow";
  const files = Array.isArray(attachments) ? attachments : [];

  const response = await firstSuccessful("Baby AI", [
    async () => {
      const result = await legacyRequest({
        text: input.toLocaleLowerCase(),
        senderID,
        font: 1
      });
      const message = extractText(result.data);
      if (!message) throw new Error("Ullash/Simsimi API returned an empty response");
      return message;
    },
    async () => {
      const result = await hinataRequest("POST", "/api/hinata", {
        text: input,
        style: SETTINGS.defaultStyle,
        attachments: files
      });
      const message = extractText(result.data);
      if (!message) throw new Error("Hinata returned an empty response");
      return message;
    },
    async () => {
      const result = await noobsRequest({
        text: input.toLocaleLowerCase(),
        senderID,
        font: 1
      });
      const message = extractText(result.data);
      if (!message) throw new Error("Fallback API returned an empty response");
      return message;
    }
  ]);

  return response;
}

function splitTeachInput(value) {
  const source = clean(value);
  const match = source.match(/\s+-\s+/);
  if (match) {
    const index = match.index;
    return {
      left: source.slice(0, index).trim(),
      right: source.slice(index + match[0].length).trim()
    };
  }

  const separator = source.indexOf("-");
  if (separator > 0) {
    return {
      left: source.slice(0, separator).trim(),
      right: source.slice(separator + 1).trim()
    };
  }

  return { left: source, right: "" };
}

async function teach(trigger, responses, userID, threadID, isIntro = false) {
  const payload = {
    trigger: lower(trigger),
    responses: clean(responses),
    userID
  };

  return firstSuccessful("Teaching", [
    async () => legacyRequest({
      teach: payload.trigger,
      reply: payload.responses,
      senderID: userID,
      threadID,
      ...(isIntro ? { key: "intro" } : {})
    }),
    async () => hinataRequest("POST", "/api/jan/teach", payload)
  ]);
}

async function teachReaction(trigger, reactions, userID, threadID) {
  const value = {
    trigger: lower(trigger),
    reactions: clean(reactions),
    userID,
    threadID
  };

  return firstSuccessful("Reaction teaching", [
    async () => legacyRequest({
      teach: value.trigger,
      react: value.reactions,
      senderID: userID,
      threadID
    }),
    async () => hinataRequest("POST", "/api/jan/teach", {
      trigger: value.trigger,
      responses: value.reactions,
      userID
    })
  ]);
}

async function removeReply(trigger, index, userID) {
  const normalizedTrigger = lower(trigger);
  if (index !== null && index !== undefined) {
    return firstSuccessful("Removing reply", [
      async () => legacyRequest({
        remove: normalizedTrigger,
        index: Number(index),
        senderID: userID
      }),
      async () => hinataRequest("DELETE", "/api/jan/remove", {
        trigger: normalizedTrigger,
        index: Number(index)
      })
    ]);
  }

  return firstSuccessful("Removing reply", [
    async () => legacyRequest({
      remove: normalizedTrigger,
      senderID: userID
    }),
    async () => hinataRequest("DELETE", "/api/jan/remove", {
      trigger: normalizedTrigger,
      index: 0
    })
  ]);
}

async function editReply(trigger, replacement, userID) {
  const oldTrigger = lower(trigger);
  const newResponse = clean(replacement);

  return firstSuccessful("Editing reply", [
    async () => legacyRequest({
      edit: oldTrigger,
      replace: newResponse,
      senderID: userID
    }),
    async () => hinataRequest("PUT", "/api/jan/edit", {
      oldTrigger,
      newResponse
    })
  ]);
}

async function lookupMessage(trigger) {
  const value = lower(trigger);
  return firstSuccessful("Message lookup", [
    async () => legacyRequest({ list: value }),
    async () => hinataRequest("GET", "/api/jan/msg", null, {
      userMessage: `msg ${value}`
    })
  ]);
}

async function getList(all = false) {
  return firstSuccessful("Teacher list", [
    async () => legacyRequest({ list: "all" }),
    async () => hinataRequest("GET", `/api/jan${all ? "/list/all" : "/list"}`)
  ]);
}

async function getUserName(usersData, id) {
  try {
    const name = await usersData?.getName?.(id);
    return clean(name) || id;
  } catch (_) {
    return id;
  }
}

function formatList(data, limit, usersData) {
  const raw =
    data?.data?.data ||
    data?.data?.teacher?.teacherList ||
    data?.teacher?.teacherList ||
    data?.data ||
    {};

  let rows = [];
  if (Array.isArray(raw)) {
    rows = raw.map((item) => {
      const id = Object.keys(item || {})[0];
      return { id, count: Number(item?.[id]) || 0 };
    }).filter((row) => row.id);
  } else if (raw && typeof raw === "object") {
    rows = Object.entries(raw).map(([id, count]) => ({
      id,
      count: Number(count) || 0
    }));
  }

  rows.sort((a, b) => b.count - a.count);
  return Promise.all(rows.slice(0, limit).map(async (row, index) => {
    const name = await getUserName(usersData, row.id);
    return `${index + 1}. ${name}: ${row.count}`;
  }));
}

function findMentionPrefix(body) {
  const source = clean(body);
  const sorted = [...SETTINGS.aliases].sort((a, b) => b.length - a.length);
  for (const alias of sorted) {
    const regex = new RegExp(`^${escapeRegExp(alias)}(?:\\s+|$)`, "i");
    const match = source.match(regex);
    if (match) {
      return {
        alias,
        text: source.slice(match[0].length).trim()
      };
    }
  }
  return null;
}

function mediaPrompt(event) {
  const type = event?.attachments?.[0]?.type || "default";
  return pick(MEDIA_MESSAGES[type] || MEDIA_MESSAGES.default);
}

async function handleCommand({ api, event, args, usersData }) {
  const raw = clean(args.join(" "));
  const command = lower(args[0]);
  const userID = event.senderID;

  if (!raw) {
    return sendReply(api, event, pick(FALLBACK_MESSAGES));
  }

  if (command === "help") {
    return sendReply(api, event, module.exports.config.guide.en);
  }

  if (command === "teach") {
    const isReact = lower(args[1]) === "react";
    const isIntro = lower(args[1]) === "amar" || lower(args[1]) === "intro";
    const prefixLength = isReact || isIntro ? 2 : 1;
    const input = args.slice(prefixLength).join(" ");
    const pair = splitTeachInput(input);

    if (!pair.left || !pair.right) {
      return sendReply(
        api,
        event,
        isReact
          ? "❌ ব্যবহার: teach react <question> - <reaction1>, <reaction2>"
          : "❌ ব্যবহার: teach <question> - <reply1>, <reply2>"
      );
    }

    const response = isReact
      ? await teachReaction(pair.left, pair.right, userID, event.threadID)
      : await teach(pair.left, pair.right, userID, event.threadID, isIntro);
    const teacher = await getUserName(usersData, userID);
    const count = response?.data?.count || response?.data?.teachs || response?.data?.teaches || "";

    return sendReply(
      api,
      event,
      `✅ শেখানো হয়েছে\n• প্রশ্ন: ${pair.left}\n• উত্তর: ${pair.right}\n• শিক্ষক: ${teacher}${count ? `\n• মোট শেখানো: ${count}` : ""}`
    );
  }

  if (command === "remove" || command === "rm") {
    const input = args.slice(1).join(" ");
    const pair = splitTeachInput(input);
    const index = command === "rm" ? Number(pair.right) : (pair.right && /^\d+$/.test(pair.right) ? Number(pair.right) : null);

    if (!pair.left || (command === "rm" && !Number.isInteger(index))) {
      return sendReply(api, event, "❌ ব্যবহার: remove <question> অথবা rm <question> - <index>");
    }

    const response = await removeReply(pair.left, index, userID);
    return sendReply(api, event, extractText(response.data) || "✅ উত্তরটি সরানো হয়েছে।");
  }

  if (command === "edit") {
    const pair = splitTeachInput(args.slice(1).join(" "));
    if (!pair.left || !pair.right) {
      return sendReply(api, event, "❌ ব্যবহার: edit <question> - <new reply>");
    }

    const response = await editReply(pair.left, pair.right, userID);
    return sendReply(api, event, extractText(response.data) || `✅ “${pair.left}” আপডেট করা হয়েছে।`);
  }

  if (command === "msg") {
    const trigger = args.slice(1).join(" ");
    if (!trigger) return sendReply(api, event, "❌ যে প্রশ্নটি খুঁজবেন সেটি লিখুন।");

    const response = await lookupMessage(trigger);
    return sendReply(api, event, extractText(response.data) || "কোনো উত্তর পাওয়া যায়নি।");
  }

  if (command === "list") {
    const all = lower(args[1]) === "all";
    const limit = Math.min(Math.max(Number(args[2]) || SETTINGS.maxTeacherRows, 1), SETTINGS.maxTeacherRows);
    const response = await getList(all);

    if (!all) {
      return sendReply(
        api,
        event,
        extractText(response.data) ||
          `📚 মোট শেখানো: ${response.data?.length || response.data?.count || "অজানা"}`
      );
    }

    const rows = await formatList(response.data, limit, usersData);
    return sendReply(
      api,
      event,
      rows.length
        ? `🏆 Baby teachers (top ${rows.length})\n\n${rows.join("\n")}`
        : "কোনো teacher তথ্য পাওয়া যায়নি।"
    );
  }

  const response = await getBotResponse(raw, event.attachments || [], userID);
  return sendReply(api, event, response);
}

module.exports.onStart = async (context) => {
  const { api, event } = context;
  if (!checkCooldown(event, "command")) return;

  try {
    react(api, event);
    typing(api, event);
    await handleCommand(context);
  } catch (error) {
    console.error("[bby:onStart]", error);
    await sendReply(api, event, `❌ Baby API error: ${asError(error)}`);
  } finally {
    typing(api, event, false);
  }
};

module.exports.onReply = async ({ api, event }) => {
  if (event.type !== "message_reply") return;
  if (!checkCooldown(event, "reply")) return;

  try {
    react(api, event);
    typing(api, event);
    const text = clean(event.body) || mediaPrompt(event);
    const response = await getBotResponse(text, event.attachments || [], event.senderID);
    await sendReply(api, event, response);
  } catch (error) {
    console.error("[bby:onReply]", error);
    await sendReply(api, event, `❌ Baby API error: ${asError(error)}`);
  } finally {
    typing(api, event, false);
  }
};

module.exports.onChat = async ({ api, event }) => {
  if (event.type === "message_reply") return;

  const mention = findMentionPrefix(event.body);
  if (!mention) return;
  if (!checkCooldown(event, "chat")) return;

  try {
    react(api, event);
    typing(api, event);

    if (!mention.text && !(event.attachments || []).length) {
      await sendReply(api, event, pick(FALLBACK_MESSAGES));
      return;
    }

    const input = mention.text || mediaPrompt(event);
    const response = await getBotResponse(input, event.attachments || [], event.senderID);
    await sendReply(api, event, response);
  } catch (error) {
    console.error("[bby:onChat]", error);
    await sendReply(api, event, `❌ Baby API error: ${asError(error)}`);
  } finally {
    typing(api, event, false);
  }
};
