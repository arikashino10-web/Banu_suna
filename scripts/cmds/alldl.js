const axios = require("axios");
const fs = require("fs");

const baseApiUrl = async () => {
  try {
    const base = await axios.get("https://raw.githubusercontent.com/mahmudx7/exe/main/baseApiUrl.json");
    return base.data.mahmud69;
  } catch (error) {
    console.error("Error fetching base API URL:", error);
    throw new Error("Could not fetch API URL");
  }
};

module.exports = {
  config: {
    name: "alldl",
    aliases: ["downloaddd", "dlll"],
    version: "1.8",
    author: "乛 SIYAM ゎ",
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

    if (!supportedSites.some(site => mahmud.toLowerCase().includes(site))) {
      return message.reply(getLang("unsupported"));
    }

    const cacheFolder = __dirname + "/cache";
    if (!fs.existsSync(cacheFolder)) {
      fs.mkdirSync(cacheFolder, { recursive: true });
    }
    
    const timestamp = Date.now();
    const randomNum = Math.floor(Math.random() * 10000);
    const path = `${cacheFolder}/alldl_${timestamp}_${randomNum}.mp4`;

    try {
      // স্টার্ট রিঅ্যাকশন
      api.setMessageReaction("🪶", event.messageID, () => {}, true);

      // API URL পাওয়া
      const base = await baseApiUrl();
      const apiUrl = `${base}/api/download?url=${encodeURIComponent(mahmud)}`;
      
      console.log("API URL:", apiUrl);

      // API থেকে ডাটা আনা
      const apiRes = await axios.get(apiUrl, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      console.log("API Response:", JSON.stringify(apiRes.data, null, 2));

      // ভিডিও ইউআরএল বের করা
      let videoUrl = null;
      if (apiRes.data) {
        if (apiRes.data.result) {
          videoUrl = apiRes.data.result;
        } else if (apiRes.data.url) {
          videoUrl = apiRes.data.url;
        } else if (apiRes.data.video) {
          videoUrl = apiRes.data.video;
        } else if (apiRes.data.data && apiRes.data.data.url) {
          videoUrl = apiRes.data.data.url;
        } else if (apiRes.data.download) {
          videoUrl = apiRes.data.download;
        } else if (apiRes.data.link) {
          videoUrl = apiRes.data.link;
        }
      }

      if (!videoUrl) {
        throw new Error("Could not extract video URL from API response");
      }

      console.log("Video URL:", videoUrl);

      // ভিডিও ডাউনলোড
      const response = await axios({
        method: "get",
        url: videoUrl,
        responseType: "arraybuffer",
        timeout: 60000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.google.com/',
          'Accept': 'video/mp4,video/*'
        }
      });

      if (!response.data || response.data.length === 0) {
        throw new Error("Downloaded file is empty");
      }

      // ফাইল সেভ
      fs.writeFileSync(path, Buffer.from(response.data));

      // সাফল্য রিঅ্যাকশন
      api.setMessageReaction("✅", event.messageID, () => {}, true);

      // ভিডিও পাঠানো
      return message.reply({
        attachment: fs.createReadStream(path)
      }, () => {
        // ৫ সেকেন্ড পর ফাইল ডিলিট
        setTimeout(() => {
          if (fs.existsSync(path)) {
            try {
              fs.unlinkSync(path);
              console.log("File deleted:", path);
            } catch (e) {
              console.error("Error deleting file:", e);
            }
          }
        }, 5000);
      });

    } catch (err) {
      console.error("Error in alldl command:", err);
      
      // এরর রিঅ্যাকশন
      api.setMessageReaction("❎", event.messageID, () => {}, true);
      
      // ফাইল ক্লিনআপ
      if (fs.existsSync(path)) {
        try {
          fs.unlinkSync(path);
        } catch (e) {
          console.error("Error deleting file:", e);
        }
      }
      
      // ইউজার ফ্রেন্ডলি এরর মেসেজ
      let errorMsg = err.message;
      if (err.code === 'ECONNABORTED') {
        errorMsg = "Request timed out. Please try again.";
      } else if (err.response) {
        if (err.response.status === 404) {
          errorMsg = "Video not found. Please check the link.";
        } else if (err.response.status === 403) {
          errorMsg = "Access denied. Please try another link.";
        } else if (err.response.status === 429) {
          errorMsg = "Too many requests. Please wait and try again.";
        } else {
          errorMsg = `Server error (${err.response.status}). Please try again later.`;
        }
      } else if (err.request) {
        errorMsg = "No response from server. Please check your internet connection.";
      }
      
      return message.reply(getLang("error", errorMsg));
    }
  }
};
