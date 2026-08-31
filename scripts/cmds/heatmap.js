const { createCanvas, loadImage } = require('canvas');
const fs = require('fs-extra');
const path = require('path');

const dataPath = path.join(__dirname, 'cache', 'activity_data.json');

const C = {
  bg: '#02060d',
  grid: '#0a1830',
  panel: '#050f20',
  panelAlt: 'rgba(255,255,255,0.03)',
  border: '#1c6fe0',
  glow: 'rgba(45,150,255,0.6)',
  cyan: '#38ecff',
  green: '#39ffb8',
  blue: '#4a90ff',
  purple: '#c07bff',
  gold: '#ffd166',
  red: '#ff5c7a',
  dim: '#82aee0',
  white: '#f5faff',
  cellEmpty: '#0c1c33',
};

const STOPWORDS = new Set([
  // English
  'the','a','an','and','or','but','is','are','was','were','be','been','being',
  'to','of','in','on','at','for','with','as','by','this','that','it','its',
  'you','your','yours','i','im','me','my','we','our','they','their','he','she',
  'his','her','them','not','no','yes','so','if','then','than','just','have',
  'has','had','do','does','did','will','would','can','could','should','what',
  'when','where','why','how','who','which','there','here','from','up','out',
  'about','into','over','after','before','again','all','any','both','each',
  'more','most','some','such','only','own','same','too','very','ok','okay',
  'lol','yeah','yep','nah','haha','hahaha','hmm','oh','ah','well',
  // Bengali (common)
  'এবং','আমি','তুমি','আপনি','সে','তারা','আমরা','তোমরা','এই','ওই','সেই',
  'হয়','হয়েছে','হবে','ছিল','করে','করেছে','করবে','না','নাই','কি','কেন',
  'কোথায়','কখন','কীভাবে','যে','যদি','তাহলে','কিন্তু','আর','এটা','ওটা',
  'একটা','একটি','তো','তাই','তবে','ভাই','আপু','ভাইয়া','হ্যাঁ','নাহ',
]);

const EMOJI_REGEX = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu;
const WORD_REGEX = /[\p{L}\p{N}']{2,}/gu;

function readData() {
  try {
    return fs.readJsonSync(dataPath);
  } catch (e) {
    return {};
  }
}

function writeData(data) {
  try {
    fs.ensureDirSync(path.dirname(dataPath));
    fs.writeJsonSync(dataPath, data);
  } catch (e) {}
}

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

function pruneFreqMap(map, keep = 150) {
  const keys = Object.keys(map);
  if (keys.length <= keep * 2) return map;
  const sorted = keys.sort((a, b) => map[b] - map[a]).slice(0, keep);
  const pruned = {};
  for (const k of sorted) pruned[k] = map[k];
  return pruned;
}

function emptyUser() {
  return {
    name: null, count: 0, mediaCount: 0, textCount: 0,
    wordCount: 0, emojiCount: 0, nightCount: 0, starterCount: 0,
    responseGapSum: 0, responseGapCount: 0
  };
}

module.exports = {
  config: {
    name: "heatmap",
    aliases: ["activity", "groupactivity", "wrapped"],
    version: "3.0",
    author: "JABED",
    countDown: 10,
    role: 0,
    description: "Full 'Group Wrapped' dashboard — activity heatmap, group photo, streaks, trends, top words, top emojis, response-time awards and superlatives",
    category: "group utility"
  },

  onChat: async function ({ api, event }) {
    try {
      const { threadID, senderID, attachments, body: rawBody } = event;
      if (!threadID || !senderID) return;

      const body = rawBody || '';
      const now = new Date();
      const dKey = dateKey(now);
      const hour = now.getHours();
      const weekday = now.getDay();
      const hasAttachment = Array.isArray(attachments) && attachments.length > 0;

      const data = readData();
      if (!data[threadID]) {
        data[threadID] = {
          daily: {}, hourly: new Array(24).fill(0), weekday: new Array(7).fill(0),
          users: {}, total: 0, textCount: 0, mediaCount: 0,
          wordFreq: {}, emojiFreq: {},
          lastSender: null, lastTimestamp: null
        };
      }
      const t = data[threadID];
      if (t.wordFreq === undefined) t.wordFreq = {};
      if (t.emojiFreq === undefined) t.emojiFreq = {};
      if (t.textCount === undefined) t.textCount = 0;
      if (t.mediaCount === undefined) t.mediaCount = 0;

      t.daily[dKey] = (t.daily[dKey] || 0) + 1;
      t.hourly[hour] += 1;
      t.weekday[weekday] += 1;
      t.total += 1;
      if (hasAttachment) t.mediaCount += 1; else t.textCount += 1;

      if (!t.users[senderID]) t.users[senderID] = emptyUser();
      const u = t.users[senderID];
      u.count += 1;
      if (hasAttachment) u.mediaCount += 1; else u.textCount += 1;
      if (hour < 5) u.nightCount += 1;

      if (!u.name) {
        try {
          const info = await api.getUserInfo(senderID);
          const uname = info && info[senderID] && info[senderID].name;
          u.name = uname || `User ${senderID.slice(-4)}`;
        } catch (e) {
          u.name = `User ${senderID.slice(-4)}`;
        }
      }

      // ---- word + emoji extraction (skipped for pure-media messages) ----
      if (body) {
        const cleanBody = body.replace(/https?:\/\/\S+/g, ' ').toLowerCase();
        const words = cleanBody.match(WORD_REGEX) || [];
        u.wordCount += words.length;
        for (const w of words) {
          if (w.length < 2 || STOPWORDS.has(w) || !isNaN(w)) continue;
          t.wordFreq[w] = (t.wordFreq[w] || 0) + 1;
        }
        const emojis = body.match(EMOJI_REGEX) || [];
        if (emojis.length) {
          u.emojiCount += emojis.length;
          for (const e of emojis) t.emojiFreq[e] = (t.emojiFreq[e] || 0) + 1;
        }
        t.wordFreq = pruneFreqMap(t.wordFreq);
        t.emojiFreq = pruneFreqMap(t.emojiFreq, 60);
      }

      // ---- conversation-starter + response-time tracking ----
      if (t.lastTimestamp) {
        const gapMs = now - new Date(t.lastTimestamp);
        const gapMin = gapMs / 60000;
        if (gapMin > 120) {
          u.starterCount += 1;
        } else if (t.lastSender && t.lastSender !== senderID) {
          u.responseGapSum += gapMs / 1000;
          u.responseGapCount += 1;
        }
      } else {
        u.starterCount += 1;
      }
      t.lastTimestamp = now.toISOString();
      t.lastSender = senderID;

      writeData(data);
    } catch (e) {
      // silent fail, never break the chat pipeline over logging
    }
  },

  onStart: async function ({ api, event }) {
    const { threadID, messageID } = event;
    const data = readData();
    const t = data[threadID];

    if (!t || t.total === 0) {
      return api.sendMessage(
        "এখনো এই গ্রুপে কোনো অ্যাক্টিভিটি ডেটা জমা হয়নি। কিছুক্ষণ চ্যাট চলুক, তারপর আবার চেষ্টা করুন।",
        threadID, messageID
      );
    }

    let groupName = "This Group";
    let groupImageUrl = null;
    try {
      const info = await api.getThreadInfo(threadID);
      if (info) {
        if (info.threadName) groupName = info.threadName;
        if (info.imageSrc) groupImageUrl = info.imageSrc;
      }
    } catch (e) {}

    try {
      const cachePath = path.join(__dirname, 'cache', `heatmap_${threadID}.png`);
      fs.ensureDirSync(path.join(__dirname, 'cache'));

      const buffer = await generateDashboard(t, groupName, groupImageUrl);
      fs.writeFileSync(cachePath, buffer);

      const topUser = Object.values(t.users).sort((a, b) => b.count - a.count)[0];
      const { current: curStreak } = computeStreaks(t.daily);
      const trend = computeTrend(t.daily);

      const caption =
`✧━━━━━━━━━━━━━━━━━━━━✧
   𝗚𝗥𝗢𝗨𝗣 𝗪𝗥𝗔𝗣𝗣𝗘𝗗 𝗗𝗔𝗦𝗛𝗕𝗢𝗔𝗥𝗗
✧━━━━━━━━━━━━━━━━━━━━✧
📊 Total tracked : ${t.total} messages
👑 Most active   : ${topUser ? topUser.name : 'N/A'}
🔥 Current streak: ${curStreak} day(s)
📈 7-day trend   : ${trend.pct >= 0 ? '+' : ''}${trend.pct}%
✧━━━━━━━━━━━━━━━━━━━━✧
⚡ Powered by JABED`;

      return api.sendMessage(
        { body: caption, attachment: fs.createReadStream(cachePath) },
        threadID, () => fs.unlinkSync(cachePath), messageID
      );
    } catch (e) {
      api.sendMessage(`Error: ${e.message}`, threadID, messageID);
    }
  }
};

function computeStreaks(daily) {
  const dates = Object.keys(daily).filter(k => daily[k] > 0).sort();
  if (dates.length === 0) return { current: 0, longest: 0 };
  const dateSet = new Set(dates);
  let longest = 0, run = 0, prev = null;
  for (const dstr of dates) {
    const d = new Date(dstr);
    if (prev && (d - prev) / 86400000 === 1) run += 1; else run = 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  let current = 0;
  let cursor = new Date();
  while (dateSet.has(dateKey(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { current, longest };
}

function computeTrend(daily) {
  const now = new Date();
  let last7 = 0, prev7 = 0;
  for (let i = 0; i < 7; i++) { const d = new Date(now); d.setDate(d.getDate() - i); last7 += daily[dateKey(d)] || 0; }
  for (let i = 7; i < 14; i++) { const d = new Date(now); d.setDate(d.getDate() - i); prev7 += daily[dateKey(d)] || 0; }
  const pct = prev7 === 0 ? (last7 > 0 ? 100 : 0) : Math.round(((last7 - prev7) / prev7) * 100);
  return { last7, prev7, pct };
}

function computeAwards(t) {
  const users = Object.entries(t.users).map(([id, u]) => ({ id, ...u }));
  const active = users.filter(u => u.count >= 5);

  const pick = (arr, keyFn, minVal = -Infinity) => {
    let best = null, bestVal = minVal;
    for (const u of arr) {
      const v = keyFn(u);
      if (v !== null && v > bestVal) { best = u; bestVal = v; }
    }
    return best ? { user: best, value: bestVal } : null;
  };
  const pickMin = (arr, keyFn, maxVal = Infinity) => {
    let best = null, bestVal = maxVal;
    for (const u of arr) {
      const v = keyFn(u);
      if (v !== null && v < bestVal) { best = u; bestVal = v; }
    }
    return best ? { user: best, value: bestVal } : null;
  };

  return {
    chatterbox: pick(users, u => u.count),
    nightOwl: pick(users, u => u.nightCount > 0 ? u.nightCount : null),
    essayWriter: pick(active, u => u.count > 0 ? u.wordCount / u.count : null),
    oneLiner: pickMin(active, u => u.count > 0 ? u.wordCount / u.count : null),
    emojiOverlord: pick(users, u => u.emojiCount > 0 ? u.emojiCount : null),
    mediaMaven: pick(users, u => u.mediaCount > 0 ? u.mediaCount : null),
    starter: pick(users, u => u.starterCount > 0 ? u.starterCount : null),
    quickDraw: pickMin(users.filter(u => u.responseGapCount >= 3), u => u.responseGapSum / u.responseGapCount)
  };
}

async function generateDashboard(t, groupName, groupImageUrl) {
  const W = 3000, H = 2650;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const bgGrad = ctx.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, W * 0.75);
  bgGrad.addColorStop(0, '#071228');
  bgGrad.addColorStop(0.55, '#03080f');
  bgGrad.addColorStop(1, '#000103');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  for (let gx = 0; gx < W; gx += 60) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
  for (let gy = 0; gy < H; gy += 60) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

  drawPanel(ctx, 30, 30, W - 60, H - 60, 34);

  // ================= HEADER =================
  const avatarSize = 130, avatarX = 100, avatarY = 65;
  await drawAvatar(ctx, groupImageUrl, avatarX, avatarY, avatarSize, groupName);

  ctx.fillStyle = C.cyan;
  ctx.font = 'bold 54px Sans';
  ctx.textAlign = 'left';
  ctx.fillText(truncate(groupName, 26), avatarX + avatarSize + 40, avatarY + 50);
  ctx.font = '600 28px Sans';
  ctx.fillStyle = C.dim;
  ctx.fillText('● GROUP WRAPPED — ADVANCED DASHBOARD', avatarX + avatarSize + 40, avatarY + 90);

  const now = new Date();
  ctx.textAlign = 'right';
  ctx.fillStyle = C.white;
  ctx.font = 'bold 34px Sans';
  ctx.fillText(now.toDateString(), W - 100, 100);
  ctx.textAlign = 'left';

  // ================= SECTION A: calendar + hourly/weekday =================
  const secAY = 260;
  const gridX = 100, gridW = 1450;
  const cell = 46, cellGap = 11, days = 91;

  const dailyVals = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    dailyVals.push(t.daily[dateKey(d)] || 0);
  }
  const maxDaily = Math.max(...dailyVals, 1);
  const peakIdx = dailyVals.indexOf(maxDaily);
  const peakDate = new Date(now); peakDate.setDate(peakDate.getDate() - (days - 1 - peakIdx));

  ctx.fillStyle = C.cyan;
  ctx.font = 'bold 32px Sans';
  ctx.fillText('☰  LAST 91 DAYS', gridX, secAY - 20);

  for (let i = 0; i < days; i++) {
    const col = Math.floor(i / 7), row = i % 7;
    const val = dailyVals[i];
    const intensity = val === 0 ? 0 : Math.min(1, val / maxDaily);
    const x = gridX + col * (cell + cellGap), y = secAY + row * (cell + cellGap);
    ctx.fillStyle = intensity === 0 ? C.cellEmpty : mixColor(C.green, intensity);
    roundRect(ctx, x, y, cell, cell, 8); ctx.fill();
    if (intensity > 0.5) { ctx.save(); ctx.shadowColor = C.green; ctx.shadowBlur = 10; ctx.fill(); ctx.restore(); }
    if (i === peakIdx && val > 0) { ctx.save(); ctx.strokeStyle = C.white; ctx.lineWidth = 3; roundRect(ctx, x, y, cell, cell, 8); ctx.stroke(); ctx.restore(); }
  }

  const legendY = secAY + 7 * (cell + cellGap) + 26;
  ctx.font = '24px monospace'; ctx.fillStyle = C.dim;
  ctx.fillText('Less', gridX, legendY + 18);
  for (let l = 0; l < 5; l++) {
    ctx.fillStyle = l === 0 ? C.cellEmpty : mixColor(C.green, l / 4);
    roundRect(ctx, gridX + 85 + l * 42, legendY, 34, 34, 6); ctx.fill();
  }
  ctx.fillStyle = C.dim;
  ctx.fillText('More', gridX + 85 + 5 * 42 + 12, legendY + 18);
  ctx.fillStyle = C.white; ctx.font = '22px monospace';
  ctx.fillText(`Peak: ${peakDate.toDateString()} (${maxDaily} msgs)`, gridX + 420, legendY + 18);

  const { current: curStreak, longest: longStreak } = computeStreaks(t.daily);
  const trend = computeTrend(t.daily);
  const stripY = legendY + 60;
  drawPanel(ctx, gridX, stripY, gridW, 120);
  const chips = [
    { label: 'CURRENT STREAK', value: `${curStreak}d`, color: C.green },
    { label: 'LONGEST STREAK', value: `${longStreak}d`, color: C.cyan },
    { label: '7-DAY TREND', value: `${trend.pct >= 0 ? '+' : ''}${trend.pct}%`, color: trend.pct >= 0 ? C.green : C.red },
  ];
  const chipW = gridW / 3;
  chips.forEach((c, i) => {
    const cx = gridX + i * chipW + chipW / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = c.color; ctx.font = 'bold 42px monospace'; ctx.fillText(c.value, cx, stripY + 65);
    ctx.fillStyle = C.dim; ctx.font = 'bold 20px monospace'; ctx.fillText(c.label, cx, stripY + 98);
    ctx.textAlign = 'left';
    if (i > 0) { ctx.strokeStyle = '#123057'; ctx.beginPath(); ctx.moveTo(gridX + i * chipW, stripY + 18); ctx.lineTo(gridX + i * chipW, stripY + 100); ctx.stroke(); }
  });

  // ---- hourly + weekday (right column of Section A) ----
  const hourX = 1650, hourW = 1250;
  const hourY = secAY, hourH = 430;
  drawPanel(ctx, hourX, hourY, hourW, hourH);
  ctx.fillStyle = C.cyan; ctx.font = 'bold 32px Sans';
  ctx.fillText('☰  ACTIVITY BY HOUR (0-23h)', hourX + 40, hourY + 55);
  const maxHour = Math.max(...t.hourly, 1);
  const bAX = hourX + 50, bAY = hourY + 100, bAW = hourW - 100, bAH = hourH - 170;
  for (let h = 0; h < 24; h++) {
    const val = t.hourly[h];
    const barH = (val / maxHour) * bAH;
    const x = bAX + h * (bAW / 24), y = bAY + bAH - barH, barW = bAW / 24 - 6;
    const grad = ctx.createLinearGradient(0, y, 0, bAY + bAH);
    grad.addColorStop(0, C.cyan); grad.addColorStop(1, C.blue);
    ctx.fillStyle = grad; roundRect(ctx, x, y, barW, Math.max(barH, 3), 4); ctx.fill();
    if (h % 3 === 0) { ctx.fillStyle = C.dim; ctx.font = '20px monospace'; ctx.textAlign = 'center'; ctx.fillText(String(h), x + barW / 2, bAY + bAH + 32); ctx.textAlign = 'left'; }
  }

  const wdY = hourY + hourH + 40, wdH = 430;
  drawPanel(ctx, hourX, wdY, hourW, wdH);
  ctx.fillStyle = C.cyan; ctx.font = 'bold 32px Sans';
  ctx.fillText('☰  ACTIVITY BY WEEKDAY', hourX + 40, wdY + 55);
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxWd = Math.max(...t.weekday, 1);
  const wAX = hourX + 50, wAY = wdY + 100, wAW = hourW - 100, wAH = wdH - 170;
  for (let d = 0; d < 7; d++) {
    const val = t.weekday[d];
    const barH = (val / maxWd) * wAH;
    const x = wAX + d * (wAW / 7) + 10, y = wAY + wAH - barH, barW2 = wAW / 7 - 20;
    ctx.fillStyle = C.purple; ctx.shadowColor = C.purple; ctx.shadowBlur = 8;
    roundRect(ctx, x, y, barW2, Math.max(barH, 3), 6); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = C.dim; ctx.font = '18px monospace'; ctx.textAlign = 'center'; ctx.fillText(String(val), x + barW2 / 2, y - 8);
    ctx.fillStyle = C.white; ctx.font = 'bold 20px monospace'; ctx.fillText(dayLabels[d], x + barW2 / 2, wAY + wAH + 32);
    ctx.textAlign = 'left';
  }

  // ================= SECTION B: AWARDS =================
  const secBY = stripY + 140 > wdY + wdH ? stripY + 140 : wdY + wdH + 40;
  const awardsY = secBY + 20, awardsH = 380;
  drawPanel(ctx, 100, awardsY, 2800, awardsH);
  ctx.fillStyle = C.gold; ctx.font = 'bold 36px Sans';
  ctx.fillText('🏆  AWARDS & SUPERLATIVES', 140, awardsY + 55);

  const awards = computeAwards(t);
  const awardDefs = [
    { key: 'chatterbox', icon: '👑', title: 'CHATTERBOX', fmt: a => `${a.value} msgs` },
    { key: 'nightOwl', icon: '🦉', title: 'NIGHT OWL', fmt: a => `${a.value} late-night msgs` },
    { key: 'essayWriter', icon: '📝', title: 'ESSAY WRITER', fmt: a => `${a.value.toFixed(1)} words/msg` },
    { key: 'oneLiner', icon: '✂️', title: 'ONE-LINER', fmt: a => `${a.value.toFixed(1)} words/msg` },
    { key: 'emojiOverlord', icon: '😂', title: 'EMOJI OVERLORD', fmt: a => `${a.value} emojis` },
    { key: 'mediaMaven', icon: '📸', title: 'MEDIA MAVEN', fmt: a => `${a.value} shared` },
    { key: 'starter', icon: '🚀', title: 'CONVO STARTER', fmt: a => `${a.value} threads started` },
    { key: 'quickDraw', icon: '⚡', title: 'QUICK DRAW', fmt: a => `${formatSecs(a.value)} avg reply` },
  ];

  const cardW = 2720 / 4, cardH = 165;
  awardDefs.forEach((def, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const cx = 140 + col * cardW, cy = awardsY + 90 + row * (cardH + 15);
    drawPanel(ctx, cx, cy, cardW - 25, cardH, 16);

    ctx.font = '52px Sans';
    ctx.fillText(def.icon, cx + 20, cy + 65);

    ctx.fillStyle = C.gold; ctx.font = 'bold 22px monospace';
    ctx.fillText(def.title, cx + 95, cy + 40);

    const a = awards[def.key];
    ctx.fillStyle = C.white; ctx.font = 'bold 26px monospace';
    ctx.fillText(truncate(a ? a.user.name : 'N/A', 16), cx + 95, cy + 78);

    ctx.fillStyle = C.dim; ctx.font = '20px monospace';
    ctx.fillText(a ? def.fmt(a) : '—', cx + 95, cy + 108);
  });

  // ================= SECTION C: leaderboard / words / emojis =================
  const secCY = awardsY + awardsH + 40;
  const colGap = 30;
  const col1W = 940, col2W = 900, col3W = 900;
  const col1X = 100, col2X = col1X + col1W + colGap, col3X = col2X + col2W + colGap;
  const secCH = 560;

  // Top chatters
  drawPanel(ctx, col1X, secCY, col1W, secCH);
  ctx.fillStyle = C.cyan; ctx.font = 'bold 32px Sans';
  ctx.fillText('★  TOP CHATTERS', col1X + 40, secCY + 55);
  const topUsers = Object.values(t.users).sort((a, b) => b.count - a.count).slice(0, 6);
  const maxUserCount = topUsers.length ? topUsers[0].count : 1;
  const ldColors = [C.green, C.cyan, C.blue, C.purple, C.dim, C.white];
  let uy = secCY + 115;
  topUsers.forEach((u, i) => {
    ctx.fillStyle = ldColors[i % ldColors.length]; ctx.font = 'bold 28px monospace';
    ctx.fillText(`#${i + 1}`, col1X + 40, uy);
    ctx.fillStyle = C.white; ctx.font = 'bold 28px monospace';
    ctx.fillText(truncate(u.name || 'Unknown', 18), col1X + 130, uy);
    drawProgressBar(ctx, col1X + 40, uy + 18, col1W - 160, 18, (u.count / maxUserCount) * 100, ldColors[i % ldColors.length]);
    ctx.fillStyle = C.dim; ctx.font = '22px monospace'; ctx.textAlign = 'right';
    ctx.fillText(`${u.count}`, col1X + col1W - 40, uy);
    ctx.textAlign = 'left';
    uy += 78;
  });

  // Top words
  drawPanel(ctx, col2X, secCY, col2W, secCH);
  ctx.fillStyle = C.cyan; ctx.font = 'bold 32px Sans';
  ctx.fillText('💬  TOP WORDS', col2X + 40, secCY + 55);
  const topWords = Object.entries(t.wordFreq || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxWordCount = topWords.length ? topWords[0][1] : 1;
  let wy = secCY + 115;
  if (topWords.length === 0) {
    ctx.fillStyle = C.dim; ctx.font = '26px monospace'; ctx.fillText('Not enough text data yet.', col2X + 40, wy);
  }
  topWords.forEach(([word, count], i) => {
    ctx.fillStyle = ldColors[i % ldColors.length]; ctx.font = 'bold 28px monospace';
    ctx.fillText(truncate(word, 16), col2X + 40, wy);
    drawProgressBar(ctx, col2X + 40, wy + 18, col2W - 160, 18, (count / maxWordCount) * 100, ldColors[i % ldColors.length]);
    ctx.fillStyle = C.dim; ctx.font = '22px monospace'; ctx.textAlign = 'right';
    ctx.fillText(`${count}x`, col2X + col2W - 40, wy);
    ctx.textAlign = 'left';
    wy += 78;
  });

  // Top emojis
  drawPanel(ctx, col3X, secCY, col3W, secCH);
  ctx.fillStyle = C.cyan; ctx.font = 'bold 32px Sans';
  ctx.fillText('😂  TOP EMOJIS', col3X + 40, secCY + 55);
  const topEmojis = Object.entries(t.emojiFreq || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxEmojiCount = topEmojis.length ? topEmojis[0][1] : 1;
  let ey = secCY + 130;
  if (topEmojis.length === 0) {
    ctx.fillStyle = C.dim; ctx.font = '26px monospace'; ctx.fillText('No emoji data yet.', col3X + 40, ey);
  }
  topEmojis.forEach(([emoji, count], i) => {
    ctx.font = '46px Sans';
    ctx.fillText(emoji, col3X + 40, ey);
    ctx.fillStyle = C.white; ctx.font = 'bold 24px monospace';
    drawProgressBar(ctx, col3X + 110, ey - 22, col3W - 260, 18, (count / maxEmojiCount) * 100, ldColors[i % ldColors.length]);
    ctx.fillStyle = C.dim; ctx.font = '22px monospace'; ctx.textAlign = 'right';
    ctx.fillText(`${count}x`, col3X + col3W - 40, ey);
    ctx.textAlign = 'left';
    ey += 78;
  });

  // ================= SECTION D: message types + summary =================
  const secDY = secCY + secCH + 40, secDH = 300;
  const dLeftW = 1360, dRightW = 1410, dRightX = 100 + dLeftW + 40;

  drawPanel(ctx, 100, secDY, dLeftW, secDH);
  ctx.fillStyle = C.cyan; ctx.font = 'bold 32px Sans';
  ctx.fillText('☰  MESSAGE TYPES', 140, secDY + 55);
  const textC = t.textCount || 0, mediaC = t.mediaCount || 0;
  const totalTM = Math.max(textC + mediaC, 1);
  const textPct = (textC / totalTM) * 100;
  const donutCx = 280, donutCy = secDY + 175, donutR = 95;
  drawDonutSegment(ctx, donutCx, donutCy, donutR, 0, textPct, C.cyan);
  drawDonutSegment(ctx, donutCx, donutCy, donutR, textPct, 100, C.purple);
  ctx.fillStyle = C.white; ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center';
  ctx.fillText(`${textPct.toFixed(0)}%`, donutCx, donutCy + 10);
  ctx.textAlign = 'left';
  ctx.fillStyle = C.cyan; ctx.font = 'bold 26px monospace';
  ctx.fillText(`● Text: ${textC}`, 460, secDY + 130);
  ctx.fillStyle = C.purple;
  ctx.fillText(`● Media/Sticker: ${mediaC}`, 460, secDY + 175);
  ctx.fillStyle = C.dim; ctx.font = '22px monospace';
  ctx.fillText(`Total classified: ${totalTM}`, 460, secDY + 220);

  drawPanel(ctx, dRightX, secDY, dRightW, secDH);
  ctx.fillStyle = C.cyan; ctx.font = 'bold 32px Sans';
  ctx.fillText('☰  SUMMARY', dRightX + 40, secDY + 55);
  const busiestHour = t.hourly.indexOf(Math.max(...t.hourly));
  const busiestDay = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][t.weekday.indexOf(Math.max(...t.weekday))];
  const activeDaysCount = Object.values(t.daily).filter(v => v > 0).length;
  const uniqueWords = Object.keys(t.wordFreq || {}).length;
  const summaryRows = [
    ['Total Messages', String(t.total)],
    ['Unique Members', String(Object.keys(t.users).length)],
    ['Active Days', String(activeDaysCount)],
    ['Busiest Hour', `${busiestHour}:00`],
    ['Busiest Day', busiestDay],
    ['Unique Words Tracked', String(uniqueWords)],
  ];
  let sy = secDY + 110;
  summaryRows.forEach(([label, value], i) => {
    if (i % 2 === 0) { ctx.fillStyle = C.panelAlt; ctx.fillRect(dRightX + 30, sy - 30, dRightW - 60, 56); }
    ctx.fillStyle = C.green; ctx.font = 'bold 24px monospace'; ctx.fillText(label, dRightX + 50, sy);
    ctx.fillStyle = C.white; ctx.font = 'bold 24px monospace'; ctx.textAlign = 'right';
    ctx.fillText(value, dRightX + dRightW - 50, sy); ctx.textAlign = 'left';
    sy += 62;
  });

  return canvas.toBuffer('image/png');
}

function formatSecs(sec) {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

async function drawAvatar(ctx, imageUrl, x, y, size, fallbackName) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  let drew = false;
  if (imageUrl) {
    try {
      const img = await loadImage(imageUrl);
      ctx.drawImage(img, x, y, size, size);
      drew = true;
    } catch (e) { drew = false; }
  }
  if (!drew) {
    const grad = ctx.createLinearGradient(x, y, x + size, y + size);
    grad.addColorStop(0, C.blue); grad.addColorStop(1, C.purple);
    ctx.fillStyle = grad; ctx.fillRect(x, y, size, size);
    ctx.fillStyle = C.white; ctx.font = `bold ${Math.floor(size * 0.45)}px Sans`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const initial = (fallbackName || '?').trim().charAt(0).toUpperCase();
    ctx.fillText(initial, x + size / 2, y + size / 2 + 4);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.lineWidth = 4; ctx.strokeStyle = C.cyan;
  ctx.shadowColor = C.glow; ctx.shadowBlur = 14;
  ctx.stroke();
  ctx.restore();
}

function drawDonutSegment(ctx, cx, cy, r, fromPct, toPct, color) {
  const start = -Math.PI / 2 + (fromPct / 100) * Math.PI * 2;
  const end = -Math.PI / 2 + (toPct / 100) * Math.PI * 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end);
  ctx.strokeStyle = color; ctx.lineWidth = 30;
  ctx.shadowColor = color; ctx.shadowBlur = 10;
  ctx.stroke(); ctx.shadowBlur = 0;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPanel(ctx, x, y, w, h, r = 20) {
  ctx.save();
  ctx.shadowColor = C.glow; ctx.shadowBlur = 16;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = C.panel; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = C.border; ctx.stroke();
  ctx.restore();
}

function drawProgressBar(ctx, x, y, w, h, pct, color) {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = '#0b1b33'; ctx.fill();
  const fillW = Math.max(h, (w * Math.min(pct, 100)) / 100);
  roundRect(ctx, x, y, fillW, h, h / 2);
  ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8;
  ctx.fill(); ctx.shadowBlur = 0;
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function mixColor(hex, intensity) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16), g = parseInt(c.substring(2, 4), 16), b = parseInt(c.substring(4, 6), 16);
  const baseR = 10, baseG = 30, baseB = 50;
  const nr = Math.round(baseR + (r - baseR) * intensity);
  const ng = Math.round(baseG + (g - baseG) * intensity);
  const nb = Math.round(baseB + (b - baseB) * intensity);
  return `rgb(${nr},${ng},${nb})`;
}
