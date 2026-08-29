const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

const baseApiUrl = async () => {
  try {
    const base = await axios.get(
      "https://raw.githubusercontent.com/mahmudx7/exe/main/baseApiUrl.json",
      { timeout: 15000 }
    );
    if (!base.data || !base.data.mahmud69) throw new Error("base URL config এ mahmud69 key পাওয়া যায়নি");
    return base.data.mahmud69;
  } catch (error) {
    throw new Error(`Base API URL fetch ব্যর্থ: ${error.message}`);
  }
};

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

// ---------- Pinterest: কোনো তৃতীয়-পক্ষ API লাগে না, সরাসরি পেজ থেকে ভিডিও বের করে ----------
async function resolvePinterestShortlink(url) {
  if (!/pin\.it/i.test(url)) return url;
  const res = await axios.get(url, {
    headers: BROWSER_HEADERS,
    timeout: 15000,
    maxRedirects: 5,
    validateStatus: () => true
  });
  return res.request?.res?.responseUrl || res.request?._redirectable?._currentUrl || url;
}

function extractFromLdJson(html) {
  const $ = cheerio.load(html);
  let found = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) return;
    try {
      const json = JSON.parse($(el).contents().text());
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        const url = item?.video?.contentUrl || item?.contentUrl;
        if (url && /\.mp4($|\?)/i.test(url)) {
          found = url;
          break;
        }
      }
    } catch { /* ignore malformed json-ld block */ }
  });
  return found;
}

function extractFromMetaTags(html) {
  const $ = cheerio.load(html);
  const candidates = [
    $('meta[property="og:video:secure_url"]').attr("content"),
    $('meta[property="og:video"]').attr("content"),
    $('meta[property="og:video:url"]').attr("content"),
    $('meta[name="twitter:player:stream"]').attr("content")
  ];
  return candidates.find(u => u && /\.mp4($|\?)/i.test(u)) || null;
}

function extractFromInlineJson(html) {
  // Pinterest মাঝে মাঝে video_list/videoUrl সরাসরি স্ক্রিপ্টের ভেতরে embed করে রাখে
  const match = html.match(/"url"\s*:\s*"(https:[^"]+\.mp4[^"]*)"/i);
  if (match) return match[1].replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  return null;
}

async function pinterestDownload(originalUrl) {
  const resolvedUrl = await resolvePinterestShortlink(originalUrl);
  const page = await axios.get(resolvedUrl, {
    headers: BROWSER_HEADERS,
    timeout: 20000
  });
  const html = page.data;
  const videoUrl = extractFromLdJson(html) || extractFromMetaTags(html) || extractFromInlineJson(html);
  if (!videoUrl) {
    throw new Error("এই Pin-এ ভিডিও পাওয়া যায়নি (এটা হয়তো একটা ছবি Pin, শুধু ভিডিও Pin-এই কাজ করবে)");
  }
  return videoUrl;
}

// ---------- অন্যান্য প্ল্যাটফর্ম: বিদ্যমান aggregator, কিন্তু স্পষ্ট ডায়াগনস্টিক সহ ----------
async function aggregatorDownload(link) {
  const base = await baseApiUrl();
  const apiUrl = `${base}/api/download?url=${encodeURIComponent(link)}`;
  console.log("[alldl] API URL:", apiUrl);

  const apiRes = await axios.get(apiUrl, {
    timeout: 30000,
    headers: { "User-Agent": BROWSER_HEADERS["User-Agent"], Accept: "application/json" }
  });
  console.log("[alldl] API Response:", JSON.stringify(apiRes.data).slice(0, 1000));

  const data = apiRes.data || {};
  const videoUrl =
    data.result || data.url || data.video ||
    data?.data?.url || data.download || data.link || null;

  if (!videoUrl) {
    throw new Error(`API রেসপন্সে ভিডিও লিংক পাওয়া যায়নি — raw response: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return videoUrl;
}

module.exports = {
  config: {
    name: "alldl",
    aliases: ["downloaddd", "dlll"],
    version: "2.0",
    author: "乛 SIYAM ゎ (updated)",
    countDown: 10,
    role: 0,
    description: {
      en: "Download videos from any social media",
      bn: "যেকোনো সোশ্যাল মিডিয়া থেকে ভিডিও ডাউনলোড করুন"
    },
    category: "media",
    guide: {
      en: "   {pn} <link>: Provide the video link"
        + "\n   Or reply to a link with {pn}",
      bn: "   {pn} <লিংক>: ভিডিও লিংক দিন"
        + "\n   অথবা {pn} দিয়ে একটি লিংকের উত্তর দিন"
    }
  },

  langs: {
    en: {
      noLink: "× Please provide a valid video link or reply to one!",
      error: "× Download error: %1",
      unsupported: "× This platform is not supported yet!"
    },
    bn: {
      noLink: "× দয়া করে একটি বৈধ ভিডিও লিংক দিন অথবা একটি লিংকের উত্তর দিন!",
      error: "× ডাউনলোড ত্রুটি: %1",
      unsupported: "× এই প্ল্যাটফর্মটি এখনও সাপোর্টেড নয়!"
    }
  },

  onStart: async function ({ api, message, args, event, getLang }) {
    const mahmud = args[0] || event.messageReply?.body;

    if (!mahmud || !mahmud.startsWith("http")) {
      return message.reply(getLang("noLink"));
    }

    const supportedSites = [
      "tiktok.com", "youtube.com", "youtu.be", "twitter.com",
      "x.com", "facebook.com", "fb.watch", "instagram.com",
      "tumblr.com", "threads.net", "spotify.com", "soundcloud.com",
      "snapchat.com", "reddit.com", "pinterest.com", "pin.it",
      "linkedin.com", "kuaishou.com", "kwai.com", "douyin.com",
      "dailymotion.com", "dai.ly", "capcut.com", "bsky.app",
      "vimeo.com", "twitch.tv"
    ];

    const lower = mahmud.toLowerCase();
    if (!supportedSites.some(site => lower.includes(site))) {
      return message.reply(getLang("unsupported"));
    }

    const isPinterest = lower.includes("pinterest.com") || lower.includes("pin.it");

    const cacheFolder = __dirname + "/cache";
    if (!fs.existsSync(cacheFolder)) fs.mkdirSync(cacheFolder, { recursive: true });
    const path = `${cacheFolder}/alldl_${Date.now()}_${Math.floor(Math.random() * 10000)}.mp4`;

    try {
      api.setMessageReaction("🪶", event.messageID, () => {}, true);

      const videoUrl = isPinterest ? await pinterestDownload(mahmud) : await aggregatorDownload(mahmud);
      console.log("[alldl] Resolved video URL:", videoUrl);

      const response = await axios({
        method: "get",
        url: videoUrl,
        responseType: "arraybuffer",
        timeout: 60000,
        headers: {
          "User-Agent": BROWSER_HEADERS["User-Agent"],
          Referer: isPinterest ? "https://www.pinterest.com/" : "https://www.google.com/",
          Accept: "video/mp4,video/*"
        }
      });

      if (!response.data || response.data.length === 0) {
        throw new Error("ডাউনলোড করা ফাইল খালি এসেছে");
      }

      fs.writeFileSync(path, Buffer.from(response.data));
      api.setMessageReaction("✅", event.messageID, () => {}, true);

      return message.reply({ attachment: fs.createReadStream(path) }, () => {
        setTimeout(() => {
          if (fs.existsSync(path)) {
            try { fs.unlinkSync(path); } catch (e) { console.error("[alldl] cleanup error:", e.message); }
          }
        }, 5000);
      });
    } catch (err) {
      console.error("[alldl] Error:", err.message);
      api.setMessageReaction("❎", event.messageID, () => {}, true);
      if (fs.existsSync(path)) {
        try { fs.unlinkSync(path); } catch { /* ignore cleanup failure */ }
      }

      let errorMsg = err.message;
      if (err.code === "ECONNABORTED") {
        errorMsg = "Request timed out. Please try again.";
      } else if (err.response) {
        if (err.response.status === 404) errorMsg = "Video not found. Please check the link.";
        else if (err.response.status === 403) errorMsg = "Access denied. Please try another link.";
        else if (err.response.status === 429) errorMsg = "Too many requests. Please wait and try again.";
        else errorMsg = `Server error (${err.response.status}). Please try again later.`;
      } else if (err.request) {
        errorMsg = "No response from server. Please check your internet connection.";
      }

      return message.reply(getLang("error", errorMsg));
    }
  }
};
