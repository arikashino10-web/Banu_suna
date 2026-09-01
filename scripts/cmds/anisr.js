const Tiktok = require('@tobyg74/tiktok-api-dl');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// Cookie lives in its own file (tiktokCookie.json), sitting right next
// to this command file. Keeping it separate means refreshing an expired
// cookie is a one-line edit — this file never needs to be touched again.
const cookiePath = path.join(__dirname, 'tiktokCookie.json');

function getCookie() {
  try {
    const data = fs.readJsonSync(cookiePath);

    // Supports THREE shapes, so however Cookie-Editor exported it, it just works:
    // 1) A raw array of cookie objects (Cookie-Editor's default "Export as JSON")
    // 2) { "cookie": [ ...array of cookie objects... ] }
    // 3) { "cookie": "sessionid=abc; tt_webid=xyz; ..." } (a plain string)
    let raw = data;
    if (!Array.isArray(data) && data && data.cookie !== undefined) {
      raw = data.cookie;
    }

    if (typeof raw === 'string') {
      if (!raw || raw === 'PASTE_YOUR_TIKTOK_COOKIE_HERE') return null;
      return raw;
    }

    if (Array.isArray(raw) && raw.length > 0) {
      // Build the "name=value; name2=value2" string TikTok's API expects
      // out of the Cookie-Editor object array.
      return raw
        .filter(c => c && c.name && c.value !== undefined)
        .map(c => `${c.name}=${c.value}`)
        .join('; ');
    }

    return null;
  } catch (e) {
    return null;
  }
}

// TikTok's CDN blocks plain requests without browser-like headers.
const VIDEO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Referer': 'https://www.tiktok.com/',
};

async function downloadVideoToFile(url, destPath) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: VIDEO_HEADERS,
    timeout: 45000,
    maxRedirects: 5,
  });

  const contentType = response.headers['content-type'] || '';
  if (!contentType.startsWith('video/') && !contentType.includes('octet-stream')) {
    throw new Error(`Unexpected content-type: "${contentType}" (link likely blocked or expired)`);
  }

  await fs.writeFile(destPath, response.data);
  const stats = await fs.stat(destPath);
  if (stats.size < 1024) {
    throw new Error(`Downloaded file too small (${stats.size} bytes) — probably not a real video.`);
  }
  return destPath;
}

module.exports = {
  config: {
    name: "anisr",
    aliases: ["animeedit", "tiktoksearch"],
    version: "3.0",
    author: "JABED",
    countDown: 10,
    role: 0,
    description: "Search and send a random TikTok anime-edit video — runs entirely in-bot via @tobyg74/tiktok-api-dl, no third-party hosted API",
    category: "anime",
    guide: {
      en: "{p}{n} [query]",
    },
  },

  onStart: async function ({ api, event, args }) {
    api.setMessageReaction("✨", event.messageID, () => {}, true);

    const query = args.join(' ').trim();
    if (!query) {
      return api.sendMessage("দয়া করে একটা সার্চ কিওয়ার্ড দিন। যেমন: anisr naruto", event.threadID, event.messageID);
    }

    const cookie = getCookie();
    if (!cookie) {
      return api.sendMessage(
        "⚠️ TikTok cookie সেট করা নেই।\n\n" +
        "tiktokCookie.json ফাইলে গিয়ে আপনার নিজের TikTok cookie বসান, তারপর আবার চেষ্টা করুন।",
        event.threadID, event.messageID
      );
    }

    const searchQuery = `${query} anime edit`;
    let result;
    try {
      result = await Tiktok.Search(searchQuery, {
        type: "video",
        page: 1,
        cookie,
      });
    } catch (e) {
      console.error('anisr: search failed:', e.message);
      return api.sendMessage(
        `সার্চ ব্যর্থ হয়েছে: ${e.message}\n\nকুকির মেয়াদ শেষ হয়ে থাকতে পারে — নতুন কুকি নিয়ে tiktokCookie.json আপডেট করুন।`,
        event.threadID, event.messageID
      );
    }

    if (!result || result.status !== 'success' || !Array.isArray(result.result) || result.result.length === 0) {
      return api.sendMessage(
        `"${query}"-এর জন্য কোনো ভিডিও পাওয়া যায়নি।\n` +
        (result && result.message ? `কারণ: ${result.message}` : 'অন্য কিওয়ার্ড দিয়ে চেষ্টা করুন, অথবা কুকি এখনো ভ্যালিড কিনা যাচাই করুন।'),
        event.threadID, event.messageID
      );
    }

    const videos = result.result;
    const selected = videos[Math.floor(Math.random() * videos.length)];
    const videoUrl = (selected.video && (selected.video.playAddr || selected.video.downloadAddr)) || null;
    const title = selected.desc || "No title available";
    const author = (selected.author && (selected.author.nickname || selected.author.uniqueId)) || "Unknown";

    if (!videoUrl) {
      return api.sendMessage("ভিডিও লিংক পাওয়া যায়নি এই রেজাল্টে, আবার চেষ্টা করুন।", event.threadID, event.messageID);
    }

    const tempPath = path.join(__dirname, 'cache', `anisr_${Date.now()}.mp4`);

    try {
      fs.ensureDirSync(path.join(__dirname, 'cache'));
      await downloadVideoToFile(videoUrl, tempPath);

      api.sendMessage(
        {
          body: `🎥 ${title}\n👤 By: ${author}\n\nএখানে আপনার ভিডিও!`,
          attachment: fs.createReadStream(tempPath),
        },
        event.threadID,
        () => fs.unlink(tempPath).catch(() => {}),
        event.messageID
      );
    } catch (e) {
      console.error('anisr: video download/send failed:', e.message);
      fs.unlink(tempPath).catch(() => {});
      api.sendMessage(
        `ভিডিওটা পাঠাতে ব্যর্থ হয়েছে।\nকারণ: ${e.message}\n\nআবার চেষ্টা করুন।`,
        event.threadID, event.messageID
      );
    }
  },
};
