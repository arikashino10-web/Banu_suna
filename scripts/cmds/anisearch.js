const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

if (!global.instaMemory) global.instaMemory = new Set();

const TUTORIAL_KEYWORDS = [
  "tutorial", "how to edit", "how to make", "how i edit", "how to create",
  "cara edit", "cara buat", "cara membuat", "edit tutorial", "editing tutorial",
  "step by step", "tuto edit", "tuto ", "learn how", "edit guide",
  "guide to edit", "capcut tutorial", "alight motion tutorial",
  "kaise edit", "edit kaise", "edit karna", "editing kaise", "coba edit",
  "belajar edit", "trik edit", "tips edit", "preset tutorial"
];

function isTutorialVideo(video) {
  const text = `${video.title || ""} ${video.desc || ""} ${video.description || ""}`.toLowerCase();
  return TUTORIAL_KEYWORDS.some(kw => text.includes(kw));
}

module.exports = {
  config: {
    name: "anisearch",
    aliases: ["anisearch"],
    version: "1.3.2",
    author: "Arafat",
    countDown: 5,
    role: 0,
    description: "Anime edits from TikTok",
    category: "media",
    guide: {
      en: "{pn} [anime name]"
    }
  },

  onStart: async function ({ api, event, args, message }) {
    const query = args.join(" ");
    if (!query) return message.reply("𝐏𝐥𝐞𝐚𝐬𝐞 𝐩𝐫𝐨𝐯𝐢𝐝𝐞 𝐚𝐧 𝐚𝐧𝐢𝐦𝐞 𝐧𝐚𝐦𝐞! 🌸");

    api.setMessageReaction("✨", event.messageID, () => {}, true);

    const cacheDir = path.join(__dirname, 'cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);
    const pathVideo = path.join(cacheDir, `anisr_${Date.now()}.mp4`);

    try {
      const searchTerms = `${query} anime edit amv no watermark`;

      const res = await axios.get(`https://azadx69x-tiktok-api.vercel.app/tiktok/search`, {
        params: { query: searchTerms },
        timeout: 15000
      });

      const rawVideos = res.data?.list;

      if (!rawVideos || rawVideos.length === 0) {
        api.setMessageReaction("❌", event.messageID, () => {}, true);
        return message.reply("");
      }

      const videos = rawVideos.filter(v => !isTutorialVideo(v));

      const getVideoId = (v) => v.video_id || v.id || v.url;

      let selectedVideo = videos.find(v => !global.instaMemory.has(getVideoId(v)));
      if (!selectedVideo) {
        global.instaMemory.clear();
        selectedVideo = videos[0];
      }
      global.instaMemory.add(getVideoId(selectedVideo));

      const downloadUrl = selectedVideo.noWatermark || selectedVideo.play || selectedVideo.wmplay;

      const videoResponse = await axios({
        method: 'get',
        url: downloadUrl,
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      await fs.writeFile(pathVideo, Buffer.from(videoResponse.data));

      await message.reply({
        body: `• 𝐇𝐞𝐫𝐞 𝐢𝐬 𝐲𝐨𝐮𝐫 𝐯𝐢𝐝𝐞𝐨 𝐛𝐚𝐛𝐲  <😘`,
        attachment: fs.createReadStream(pathVideo)
      });

      api.setMessageReaction("🌸", event.messageID, () => {}, true);

    } catch (err) {
      console.error("DEBUG ERROR:", err.message);
      api.setMessageReaction("⚠️", event.messageID, () => {}, true);

      const errorMsg = err.code === 'ECONNABORTED'
        ? "⚠️ | 𝐂𝐨𝐧𝐧𝐞𝐜𝐭𝐢𝐨𝐧 𝐭𝐢𝐦𝐞𝐝 𝐨𝐮𝐭. 𝐓𝐫𝐲 𝐚𝐠𝐚𝐢𝐧!"
        : "⚠️ | 𝐒𝐞𝐫𝐯𝐞𝐫 𝐢𝐬 𝐛𝐮𝐬𝐲 𝐨𝐫 𝐀𝐏𝐈 𝐢𝐬 𝐝𝐨𝐰𝐧. 𝐓𝐫𝐲 𝐚𝐠𝐚𝐢𝐧!";

      return message.reply(errorMsg);
    } finally {
      if (fs.existsSync(pathVideo)) {
        setTimeout(() => {
          try { fs.unlinkSync(pathVideo); } catch(e) {}
        }, 20000);
      }
    }
  }
};
