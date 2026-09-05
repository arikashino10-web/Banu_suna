const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { createCanvas, loadImage } = require("canvas");

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const cooldown = new Map();

const CACHE_DIR = path.join(__dirname, "cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const VIP_PRICES = {
  1: 10_000_000,
  2: 20_000_000,
  3: 30_000_000,
  4: 40_000_000,
  5: 50_000_000,
  6: 60_000_000,
  7: 70_000_000
};

const BASE_PRICE_PER_DAY = 10_000_000;

const LIST_PAGE_SIZE = 10;

const formatDatePlain = ts => {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2,"0")}-${String(d.getMonth()+1).padStart(2,"0")}-${d.getFullYear()}`;
};

const formatMoneyPlain = n => {
  if (n >= 1e9) return `$${(n/1e9).toFixed(n%1e9?1:0)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(n%1e6?1:0)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(n%1e3?1:0)}K`;
  return `$${n}`;
};

const calculatePrice = (days) => {
  if (VIP_PRICES[days]) return VIP_PRICES[days];
  return days * BASE_PRICE_PER_DAY;
};

const getTimeRemainingPlain = (expiryTimestamp) => {
  const now = Date.now();
  const diff = expiryTimestamp - now;
  if (diff <= 0) return { text: "Expired", days: 0 };

  const days = Math.floor(diff / DAY);
  const hours = Math.floor((diff % DAY) / HOUR);

  return {
    text: days === 0 ? `${hours}h left` : `${days}d ${hours}h left`,
    days
  };
};

const PALETTE = {
  bgTop: "#020203",
  bgMid: "#0a0a11",
  bgBottom: "#000000",
  gold: ["#fff6d8", "#f3d581", "#c9922a", "#f3d581", "#7a5510"],
  rose: ["#ffe3da", "#e3a58f", "#a85c42", "#e3a58f", "#5e2f1f"],
  platinum: ["#ffffff", "#e2e2e2", "#9a9a9a", "#e2e2e2", "#5c5c5c"],
  emerald: ["#c9f7e4", "#3fd18c", "#0d6b45", "#3fd18c", "#063d28"],
  garnetGrad: ["#ffc9c9", "#e05a5a", "#7a1f1f", "#e05a5a", "#3d0f0f"],
  ink: "#e0524f",
  text: "#f6f1e4",
  muted: "#9b937f"
};

function lineGradient(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  const n = stops.length - 1;
  stops.forEach((c, i) => g.addColorStop(i / n, c));
  return g;
}

function fillTextTracked(ctx, text, cx, y, spacing) {
  const chars = text.split("");
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  const widths = chars.map(c => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let x = cx - total / 2;
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x, y);
    x += widths[i] + spacing;
  }
  ctx.textAlign = prevAlign;
}

function hexPath(ctx, cx, cy, r, rotationDeg = -90) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (rotationDeg + i * 60);
    const px = cx + r * Math.cos(a);
    const py = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawHexGrid(ctx, width, height, r, alpha, color) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const hSpacing = Math.sqrt(3) * r;
  const vSpacing = 1.5 * r;
  let row = 0;
  for (let y = -r; y < height + r; y += vSpacing) {
    const offsetX = (row % 2 === 0) ? 0 : hSpacing / 2;
    for (let x = -r; x < width + r; x += hSpacing) {
      hexPath(ctx, x + offsetX, y, r);
      ctx.stroke();
    }
    row++;
  }
  ctx.restore();
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawEmblem(ctx, cx, cy, size, colorStops) {
  const w = size, h = size * 1.15;
  ctx.save();
  ctx.translate(cx, cy);

  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.lineTo(w / 2, -h / 2 + h * 0.28);
  ctx.lineTo(w * 0.32, h / 2);
  ctx.lineTo(-w * 0.32, h / 2);
  ctx.lineTo(-w / 2, -h / 2 + h * 0.28);
  ctx.closePath();
  ctx.fillStyle = lineGradient(ctx, -w / 2, -h / 2, w / 2, h / 2, colorStops);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -h / 2); ctx.lineTo(0, h / 2);
  ctx.moveTo(-w / 2, -h / 2 + h * 0.28); ctx.lineTo(0, -h * 0.05);
  ctx.moveTo(w / 2, -h / 2 + h * 0.28); ctx.lineTo(0, -h * 0.05);
  ctx.moveTo(-w * 0.32, h / 2); ctx.lineTo(0, -h * 0.05);
  ctx.moveTo(w * 0.32, h / 2); ctx.lineTo(0, -h * 0.05);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.moveTo(-w * 0.08, -h * 0.42);
  ctx.lineTo(0, -h * 0.30);
  ctx.lineTo(w * 0.08, -h * 0.42);
  ctx.lineTo(0, -h * 0.50);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function baseShop(width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, PALETTE.bgTop);
  bg.addColorStop(0.5, PALETTE.bgMid);
  bg.addColorStop(1, PALETTE.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  drawHexGrid(ctx, width, height, 24, 0.05, "#f3d581");

  const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, height * 0.9);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width / 2, -30, 10, width / 2, -30, width * 0.65);
  glow.addColorStop(0, "rgba(243,213,129,0.28)");
  glow.addColorStop(1, "rgba(243,213,129,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height * 0.55);

  ctx.strokeStyle = lineGradient(ctx, 0, 0, width, height, PALETTE.gold);
  ctx.lineWidth = 3;
  drawRoundedRect(ctx, 14, 14, width - 28, height - 28, 18);
  ctx.stroke();
  ctx.strokeStyle = "rgba(243,213,129,0.5)";
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, 22, 22, width - 44, height - 44, 14);
  ctx.stroke();

  const tick = (x, y) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = "#f3d581";
    ctx.fillRect(-3, -3, 6, 6);
    ctx.restore();
  };
  tick(22, 22); tick(width - 22, 22); tick(22, height - 22); tick(width - 22, height - 22);

  return { canvas, ctx };
}

function drawHeaderPlaque(ctx, width, title, subtitle) {
  const topY = 44;

  drawEmblem(ctx, width / 2, topY + 36, 44, PALETTE.gold);

  ctx.textAlign = "center";
  ctx.font = "bold 30px sans-serif";
  ctx.fillStyle = lineGradient(ctx, width / 2 - 220, 0, width / 2 + 220, 0, PALETTE.gold);
  fillTextTracked(ctx, title.toUpperCase(), width / 2, topY + 108, 6);

  if (subtitle) {
    ctx.font = "13px sans-serif";
    ctx.fillStyle = PALETTE.muted;
    fillTextTracked(ctx, subtitle.toUpperCase(), width / 2, topY + 132, 3);
  }

  const lineY = topY + 156;
  ctx.strokeStyle = "rgba(243,213,129,0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 180, lineY);
  ctx.lineTo(width / 2 - 14, lineY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(width / 2 + 14, lineY);
  ctx.lineTo(width / 2 + 180, lineY);
  ctx.stroke();

  ctx.save();
  ctx.translate(width / 2, lineY);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "#f3d581";
  ctx.fillRect(-4, -4, 8, 8);
  ctx.restore();
}

function drawCornerSeal(ctx, width, text) {
  const cx = width - 74, cy = 74, r = 34;
  ctx.save();

  hexPath(ctx, cx, cy, r);
  ctx.fillStyle = lineGradient(ctx, cx - r, cy - r, cx + r, cy + r, PALETTE.platinum);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  hexPath(ctx, cx, cy, r * 0.74);
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.font = "bold 9px sans-serif";
  ctx.fillStyle = "#141414";
  ctx.fillText(text.toUpperCase(), cx, cy + 3);
  ctx.restore();
}

const CYAN = { bright: "#eafcff", mid: "#4be3ff", deep: "#0a6c86", dark: "#053544" };

function baseTerminal(width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#030608");
  bg.addColorStop(0.55, "#05141c");
  bg.addColorStop(1, "#010304");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = CYAN.mid;
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 28) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y < height; y += 28) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = CYAN.mid;
  for (let y = 0; y < height; y += 4) {
    ctx.fillRect(0, y, width, 1);
  }
  ctx.restore();

  const glow = ctx.createRadialGradient(width / 2, -20, 10, width / 2, -20, width * 0.6);
  glow.addColorStop(0, "rgba(75,227,255,0.22)");
  glow.addColorStop(1, "rgba(75,227,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height * 0.5);

  const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.25, width / 2, height / 2, height * 0.9);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(75,227,255,0.55)";
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, 16, 16, width - 32, height - 32, 10);
  ctx.stroke();

  return { canvas, ctx };
}

function drawHUDCorners(ctx, width, height, color = CYAN.mid) {
  const len = 30, inset = 26;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  const corners = [
    [inset, inset, 1, 1],
    [width - inset, inset, -1, 1],
    [inset, height - inset, 1, -1],
    [width - inset, height - inset, -1, -1]
  ];
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x, y + len * dy);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len * dx, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDigitalHeader(ctx, width, title, subtitle) {
  const topY = 44;
  const cx = width / 2, cy = topY + 34;

  ctx.strokeStyle = "rgba(75,227,255,0.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 26, cy); ctx.lineTo(cx - 92, cy); ctx.lineTo(cx - 92, cy - 16);
  ctx.moveTo(cx + 26, cy); ctx.lineTo(cx + 92, cy); ctx.lineTo(cx + 92, cy - 16);
  ctx.stroke();
  const node = (x, y) => { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = CYAN.mid; ctx.fill(); };
  node(cx - 92, cy - 16); node(cx + 92, cy - 16);

  hexPath(ctx, cx, cy, 26);
  ctx.fillStyle = lineGradient(ctx, cx - 26, cy - 26, cx + 26, cy + 26,
    [CYAN.bright, CYAN.mid, CYAN.deep, CYAN.mid, CYAN.dark]);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#03222b";
  ctx.fillRect(cx - 7, cy - 7, 14, 14);
  ctx.strokeStyle = CYAN.mid;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 7, cy - 7, 14, 14);

  ctx.textAlign = "center";
  ctx.font = "bold 27px monospace";
  ctx.fillStyle = lineGradient(ctx, cx - 200, 0, cx + 200, 0, [CYAN.bright, CYAN.mid, CYAN.bright]);
  fillTextTracked(ctx, title.toUpperCase(), cx, topY + 100, 5);

  if (subtitle) {
    ctx.font = "12px monospace";
    ctx.fillStyle = "#7fb8c9";
    fillTextTracked(ctx, subtitle.toUpperCase(), cx, topY + 122, 3);
  }

  const lineY = topY + 144;
  ctx.strokeStyle = "rgba(75,227,255,0.4)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(cx - 200, lineY);
  ctx.lineTo(cx + 200, lineY);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawDigitalRow(ctx, x, y, width, label, value, ratio = 0, accentColor = CYAN.mid) {
  const rowH = 34, top = y - 24;

  ctx.fillStyle = "rgba(75,227,255,0.06)";
  drawRoundedRect(ctx, x, top, width, rowH, 6);
  ctx.fill();

  const barW = Math.max(6, width * Math.min(1, Math.max(0, ratio)));
  ctx.save();
  ctx.beginPath();
  drawRoundedRect(ctx, x, top, width, rowH, 6);
  ctx.clip();
  ctx.fillStyle = lineGradient(ctx, x, 0, x + barW, 0, ["rgba(75,227,255,0.28)", "rgba(75,227,255,0.03)"]);
  ctx.fillRect(x, top, barW, rowH);
  ctx.restore();

  ctx.strokeStyle = "rgba(75,227,255,0.3)";
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, x, top, width, rowH, 6);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.font = "14px monospace";
  ctx.fillStyle = "#bfe9f5";
  ctx.fillText(label, x + 14, y);

  ctx.textAlign = "right";
  ctx.font = "bold 17px monospace";
  ctx.fillStyle = accentColor;
  ctx.fillText(value, x + width - 14, y);
}

function drawApprovalChip(ctx, cx, cy, text, color = CYAN.mid) {
  const label = text.toUpperCase();
  ctx.save();
  ctx.font = "bold 15px monospace";
  const textW = ctx.measureText(label).width;
  const w = textW + 46, h = 34;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, cx - w / 2, cy - h / 2, w, h, 6);
  ctx.stroke();
  ctx.fillStyle = "rgba(75,227,255,0.08)";
  drawRoundedRect(ctx, cx - w / 2, cy - h / 2, w, h, 6);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx - w / 2 + 16, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(label, cx - w / 2 + 30, cy + 1);
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

function drawPriceChip(ctx, x, y, text, color = CYAN.bright) {
  ctx.save();
  ctx.font = "bold 20px monospace";
  const label = `[ ${text} ]`;
  ctx.textAlign = "left";
  ctx.fillStyle = color;
  ctx.fillText(label, x, y);
  ctx.restore();
}

function drawStamp(ctx, cx, cy, text, color, rotationDeg = -14) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.globalAlpha = 0.9;

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, 60, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, 52, 0, Math.PI * 2); ctx.stroke();

  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    const x = Math.cos(a) * 56, y = Math.sin(a) * 56;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 4);
    ctx.fillStyle = color;
    ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
  }

  ctx.textAlign = "center";
  ctx.font = "bold 17px sans-serif";
  ctx.fillStyle = color;
  const lines = text.toUpperCase().split(" ");
  if (lines.length === 1) {
    ctx.fillText(lines[0], 0, 6);
  } else {
    ctx.fillText(lines[0], 0, -5);
    ctx.font = "bold 13px sans-serif";
    ctx.fillText(lines.slice(1).join(" "), 0, 15);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawPriceTag(ctx, x, y, text, rotationDeg = -6) {
  const w = 150, h = 46;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotationDeg * Math.PI) / 180);

  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(18, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, h);
  ctx.lineTo(18, h);
  ctx.closePath();
  ctx.fillStyle = lineGradient(ctx, 0, 0, w, 0, PALETTE.gold);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(20, h / 2, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#0d1420";
  ctx.fill();

  ctx.textAlign = "center";
  ctx.font = "bold 20px sans-serif";
  ctx.fillStyle = "#1c1409";
  ctx.fillText(text, (w + 18) / 2, h / 2 + 7);
  ctx.restore();
}

function drawReceiptRow(ctx, x, y, width, label, value, accent = PALETTE.text) {
  ctx.textAlign = "left";
  ctx.font = "20px sans-serif";
  ctx.fillStyle = PALETTE.muted;
  ctx.fillText(label, x, y);
  const labelW = ctx.measureText(label).width;

  ctx.textAlign = "right";
  ctx.font = "bold 22px sans-serif";
  ctx.fillStyle = accent;
  const valueW = ctx.measureText(value).width;

  ctx.strokeStyle = "rgba(244,240,230,0.25)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(x + labelW + 12, y - 5);
  ctx.lineTo(x + width - valueW - 12, y - 5);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillText(value, x + width, y);
}

function drawMedal(ctx, cx, cy, rank) {
  const colors = {
    1: ["#fff6cf", "#f7d774", "#c9922a"],
    2: ["#f4f4f4", "#cfcfcf", "#9a9a9a"],
    3: ["#f0c9a0", "#c98a4b", "#8a5622"]
  };
  const stops = colors[rank] || ["#4a4536", "#33301f", "#1f1c10"];
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 20, 0, Math.PI * 2);
  ctx.fillStyle = lineGradient(ctx, cx - 20, cy - 20, cx + 20, cy + 20, stops);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.font = "bold 16px sans-serif";
  ctx.fillStyle = "#1c1409";
  ctx.fillText(String(rank), cx, cy + 5);
  ctx.restore();
}

function getInitial(name) {
  if (!name) return "V";
  const firstWord = String(name).trim().split(/\s+/)[0] || "";
  return (firstWord[0] || "V").toUpperCase();
}

function drawAvatar(ctx, cx, cy, radius, name, { colors = PALETTE.gold, textColor = "#1c1409", fontScale = 0.85 } = {}) {
  ctx.save();
  hexPath(ctx, cx, cy, radius);
  ctx.fillStyle = lineGradient(ctx, cx - radius, cy - radius, cx + radius, cy + radius, colors);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = Math.max(1.2, radius * 0.05);
  ctx.stroke();

  hexPath(ctx, cx, cy, radius * 0.8);
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.round(radius * fontScale)}px sans-serif`;
  ctx.fillStyle = textColor;
  ctx.fillText(getInitial(name), cx, cy + radius * 0.05);
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

/* ── AVATAR SYSTEM ──
   Multi-source, timeout-protected profile picture fetching.
   Tries, in order: usersData.getAvatarUrl -> usersData.getData (avatarUrl/
   profilePicture/thumbSrc/avatar) -> api.getUserInfo (thumbSrc/profileUrl)
   -> Facebook Graph API picture endpoint (always-available fallback).
   Each candidate URL is loaded via a streaming fetch first (if the bot
   framework exposes global.utils.getStreamFromURL), then via a direct
   axios request, both guarded by timeouts so a slow/dead host can never
   hang banner generation. */

function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))
  ]);
}

async function loadFromUrl(url) {
  if (!url) return null;
  try {
    const res = await withTimeout(
      axios.get(url, { responseType: "arraybuffer", timeout: 7000 }),
      8500
    );
    const buf = Buffer.from(res.data);
    if (buf.length < 100) return null;
    return await loadImage(buf);
  } catch (e) {
    return null;
  }
}

async function loadFromStream(url) {
  if (!url || typeof global?.utils?.getStreamFromURL !== "function") return null;
  try {
    const stream = await withTimeout(global.utils.getStreamFromURL(url), 8000);
    if (!stream) return null;
    const chunks = [];
    await withTimeout(
      new Promise((res, rej) => {
        stream.on("data", c => chunks.push(c));
        stream.on("end", () => res());
        stream.on("error", rej);
      }),
      8000
    );
    const buf = Buffer.concat(chunks);
    if (buf.length < 100) return null;
    return await loadImage(buf);
  } catch (e) {
    return null;
  }
}

async function fetchAvatarImage(uid, api, usersData) {
  if (!uid) return null;
  const urls = [];

  if (typeof usersData?.getAvatarUrl === "function") {
    try {
      const u = await withTimeout(usersData.getAvatarUrl(uid), 4000);
      if (u) urls.push(u);
    } catch (e) {}
  }
  if (typeof usersData?.getData === "function") {
    try {
      const d = await withTimeout(usersData.getData(uid), 4000);
      for (const key of ["avatarUrl", "profilePicture", "thumbSrc", "avatar"]) {
        if (d?.[key]) { urls.push(d[key]); break; }
      }
    } catch (e) {}
  }
  if (api?.getUserInfo) {
    try {
      const info = await withTimeout(api.getUserInfo(uid), 4000);
      const u = info?.[uid]?.thumbSrc || info?.[uid]?.profileUrl;
      if (u) urls.push(u);
    } catch (e) {}
  }
  urls.push(`https://graph.facebook.com/${uid}/picture?width=512&height=512&type=large`);

  for (const url of urls) {
    const img = (await loadFromStream(url)) || (await loadFromUrl(url));
    if (img) return img;
  }
  return null;
}

async function fetchAvatarImages(uids, api, usersData) {
  const map = {};
  await Promise.all(
    [...new Set(uids)].map(async uid => {
      map[uid] = await fetchAvatarImage(uid, api, usersData);
    })
  );
  return map;
}

async function drawAvatarSmart(ctx, cx, cy, radius, name, avatarImg, opts = {}) {
  if (avatarImg) {
    try {
      const img = avatarImg;
      ctx.save();
      hexPath(ctx, cx, cy, radius);
      ctx.clip();
      const scale = Math.max((radius * 2) / img.width, (radius * 2) / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
      ctx.restore();

      hexPath(ctx, cx, cy, radius);
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = Math.max(1.2, radius * 0.05);
      ctx.stroke();
      hexPath(ctx, cx, cy, radius * 0.9);
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    } catch (e) {
      // fall through to the letter badge below
    }
  }
  drawAvatar(ctx, cx, cy, radius, name, opts);
}

function drawStars(ctx, cx, cy, filled) {
  const spacing = 22;
  const startX = cx - spacing * 2;
  for (let i = 0; i < 5; i++) {
    drawStar(ctx, startX + i * spacing, cy, 9, i < filled ? "#f7d774" : "rgba(244,240,230,0.2)");
  }
}

function drawStar(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    ctx.lineTo(Math.cos((18 + i * 72) * Math.PI / 180) * r, -Math.sin((18 + i * 72) * Math.PI / 180) * r);
    ctx.lineTo(Math.cos((54 + i * 72) * Math.PI / 180) * r * 0.4, -Math.sin((54 + i * 72) * Math.PI / 180) * r * 0.4);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function tierFromDays(days) {
  if (days >= 30) return { label: "PLATINUM", stars: 5 };
  if (days >= 15) return { label: "GOLD", stars: 4 };
  if (days >= 7) return { label: "SILVER", stars: 3 };
  if (days >= 1) return { label: "BRONZE", stars: 2 };
  return { label: "MEMBER", stars: 1 };
}

function saveCanvas(canvas, filename) {
  const filePath = path.join(CACHE_DIR, filename);
  fs.writeFileSync(filePath, canvas.toBuffer("image/png"));
  return filePath;
}

async function generateBuyBanner({ name, days, price, remaining, expires, avatarImg }) {
  const W = 940, H = 670;
  const { canvas, ctx } = baseTerminal(W, H);
  drawDigitalHeader(ctx, W, "VIP MARKETPLACE", "Digital Purchase Terminal");
  drawHUDCorners(ctx, W, H);

  const cardX = 80, cardY = 250, cardW = W - 160, cardH = 130;
  ctx.fillStyle = "rgba(75,227,255,0.05)";
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(75,227,255,0.4)";
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 12);
  ctx.stroke();

  const avR = 30, avX = cardX + 30 + avR, avY = cardY + 82;
  await drawAvatarSmart(ctx, avX, avY, avR, name, avatarImg, { colors: [CYAN.bright, CYAN.mid, CYAN.deep, CYAN.mid, CYAN.dark] });

  const textX = cardX + 30 + avR * 2 + 20;
  ctx.textAlign = "left";
  ctx.font = "bold 24px monospace";
  ctx.fillStyle = CYAN.bright;
  ctx.fillText("VIP MEMBERSHIP PASS", textX, cardY + 44);
  ctx.font = "15px monospace";
  ctx.fillStyle = "#7fb8c9";
  ctx.fillText(`USER: ${name}`, textX, cardY + 74);
  ctx.fillText(`ACCESS: ${days}-DAY`, textX, cardY + 100);

  drawPriceChip(ctx, cardX + cardW - 180, cardY + 30, formatMoneyPlain(price));

  drawApprovalChip(ctx, cardX + cardW - 100, cardY + cardH + 40, "APPROVED", CYAN.mid);

  const maxTierPrice = calculatePrice(30);
  const rowX = 80, rowW = W - 160;
  let y = 470;
  const gap = 46;
  drawDigitalRow(ctx, rowX, y, rowW, "DURATION", `${days} DAYS`, Math.min(1, days / 30)); y += gap;
  drawDigitalRow(ctx, rowX, y, rowW, "AMOUNT PAID", formatMoneyPlain(price), Math.min(1, price / maxTierPrice), CYAN.bright); y += gap;
  drawDigitalRow(ctx, rowX, y, rowW, "BALANCE REMAINING", formatMoneyPlain(remaining), remaining / (remaining + price || 1)); y += gap;
  drawDigitalRow(ctx, rowX, y, rowW, "VALID UNTIL", formatDatePlain(expires).toUpperCase(), 0.15);

  return saveCanvas(canvas, `vip_buy_${Date.now()}.png`);
}

async function generateStatusBanner({ name, expires, timeLeft, avatarImg }) {
  const W = 940, H = 560;
  const { canvas, ctx } = baseTerminal(W, H);
  drawDigitalHeader(ctx, W, "VIP MARKETPLACE", "Membership Status Terminal");
  drawHUDCorners(ctx, W, H);

  const tier = tierFromDays(timeLeft.days);

  const avX = W / 2, avY = 250, avR = 46;
  await drawAvatarSmart(ctx, avX, avY, avR, name, avatarImg, { colors: [CYAN.bright, CYAN.mid, CYAN.deep, CYAN.mid, CYAN.dark] });

  ctx.textAlign = "center";
  ctx.font = "bold 26px monospace";
  ctx.fillStyle = CYAN.bright;
  ctx.fillText(name, W / 2, avY + 82);

  ctx.font = "bold 13px monospace";
  ctx.fillStyle = "#7fb8c9";
  ctx.fillText(`${tier.label} TIER`, W / 2, avY + 106);

  drawApprovalChip(ctx, W / 2, avY + 144, "ACTIVE", CYAN.mid);

  const rowX = 80, rowW = W - 160;
  let y = 410;
  const gap = 46;
  drawDigitalRow(ctx, rowX, y, rowW, "STATUS", "ACTIVE MEMBER", 1, CYAN.mid); y += gap;
  drawDigitalRow(ctx, rowX, y, rowW, "VALID UNTIL", formatDatePlain(expires).toUpperCase(), 0.4); y += gap;
  drawDigitalRow(ctx, rowX, y, rowW, "TIME REMAINING", timeLeft.text.toUpperCase(), Math.min(1, timeLeft.days / 30), CYAN.bright);

  return saveCanvas(canvas, `vip_status_${Date.now()}.png`);
}

async function generateListBanner(pageUsers, page, totalPages, totalCount) {
  const rows = pageUsers.length;
  const rowHeight = 60;
  const W = 940;
  const H = 300 + rows * rowHeight + 70;
  const { canvas, ctx } = baseTerminal(W, H);
  drawDigitalHeader(ctx, W, "VIP MARKETPLACE", `Member Directory  //  Page ${page} of ${totalPages}`);
  drawHUDCorners(ctx, W, H);

  const startX = 80, endX = W - 80;
  let y = 270;

  ctx.textAlign = "left";
  ctx.font = "bold 13px monospace";
  ctx.fillStyle = CYAN.bright;
  ctx.fillText("MEMBER", startX + 56, y);
  ctx.textAlign = "right";
  ctx.fillText("VALID UNTIL", startX + 400, y);
  ctx.fillText("TIME LEFT", endX, y);

  y += 12;
  ctx.strokeStyle = "rgba(75,227,255,0.35)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(endX, y); ctx.stroke();
  ctx.setLineDash([]);

  y += 34;
  const baseRank = (page - 1) * LIST_PAGE_SIZE;
  for (let i = 0; i < rows; i++) {
    const u = pageUsers[i];
    const top = y - 26;

    ctx.fillStyle = "rgba(75,227,255,0.05)";
    drawRoundedRect(ctx, startX, top, endX - startX, 42, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(75,227,255,0.28)";
    ctx.lineWidth = 1;
    drawRoundedRect(ctx, startX, top, endX - startX, 42, 6);
    ctx.stroke();

    drawMedal(ctx, startX + 26, y - 4, baseRank + i + 1);
    await drawAvatarSmart(ctx, startX + 78, y - 4, 16, u.name, u.avatarImg, { colors: [CYAN.bright, CYAN.mid, CYAN.deep, CYAN.mid, CYAN.dark] });

    ctx.textAlign = "left";
    ctx.font = "bold 16px monospace";
    ctx.fillStyle = CYAN.bright;
    ctx.fillText(u.name, startX + 106, y);

    ctx.textAlign = "right";
    ctx.font = "13px monospace";
    ctx.fillStyle = "#7fb8c9";
    ctx.fillText(u.expiresText.toUpperCase(), startX + 400, y);

    ctx.font = "bold 14px monospace";
    ctx.fillStyle = CYAN.bright;
    ctx.fillText(`[ ${u.timeLeftText.toUpperCase()} ]`, endX, y);

    y += rowHeight;
  }

  ctx.textAlign = "center";
  ctx.font = "11px monospace";
  ctx.fillStyle = "rgba(75,227,255,0.5)";
  ctx.fillText(`${totalCount} TOTAL MEMBERS  //  PAGE ${page}/${totalPages}`, W / 2, y + 20);

  return saveCanvas(canvas, `vip_list_${Date.now()}.png`);
}

async function generateAddBanner({ targetName, days, expires, avatarImg }) {
  const W = 940, H = 510;
  const { canvas, ctx } = baseTerminal(W, H);
  drawDigitalHeader(ctx, W, "VIP MARKETPLACE", "Admin Grant Terminal");
  drawHUDCorners(ctx, W, H);

  await drawAvatarSmart(ctx, W / 2, 190, 40, targetName, avatarImg, { colors: [CYAN.bright, CYAN.mid, CYAN.deep, CYAN.mid, CYAN.dark] });

  ctx.textAlign = "center";
  ctx.font = "bold 26px monospace";
  ctx.fillStyle = CYAN.bright;
  ctx.fillText(targetName, W / 2, 262);
  ctx.font = "14px monospace";
  ctx.fillStyle = "#7fb8c9";
  ctx.fillText("HAS BEEN GRANTED VIP ACCESS", W / 2, 288);

  drawApprovalChip(ctx, W / 2, 322, "GRANTED", CYAN.mid);

  const rowX = 80, rowW = W - 160;
  let y = 400;
  const gap = 46;
  drawDigitalRow(ctx, rowX, y, rowW, "DURATION ADDED", `${days} DAYS`, Math.min(1, days / 30), CYAN.bright); y += gap;
  drawDigitalRow(ctx, rowX, y, rowW, "NEW EXPIRY", formatDatePlain(expires).toUpperCase(), 0.4);

  return saveCanvas(canvas, `vip_add_${Date.now()}.png`);
}

async function generateRemoveBanner({ targetName, avatarImg }) {
  const W = 940, H = 400;
  const { canvas, ctx } = baseTerminal(W, H);
  drawDigitalHeader(ctx, W, "VIP MARKETPLACE", "Admin Revocation Terminal");
  drawHUDCorners(ctx, W, H);

  await drawAvatarSmart(ctx, W / 2, 190, 34, targetName, avatarImg, {
    colors: ["#ffd6d6", "#ff8a8a", "#a83232", "#ff8a8a", "#5e1414"],
    textColor: "#2b0a0a"
  });

  ctx.textAlign = "center";
  ctx.font = "bold 24px monospace";
  ctx.fillStyle = "#ff8a8a";
  ctx.fillText(targetName, W / 2, 272);
  ctx.font = "14px monospace";
  ctx.fillStyle = "#c98a8a";
  ctx.fillText("VIP MEMBERSHIP HAS BEEN REVOKED", W / 2, 298);

  drawApprovalChip(ctx, W / 2, 334, "REVOKED", "#ff5a5a");

  return saveCanvas(canvas, `vip_remove_${Date.now()}.png`);
}

function generatePriceListBanner() {
  const tiers = [1, 2, 3, 4, 5, 6, 7, 15, 30].map(d => [d, calculatePrice(d)]);
  const rowHeight = 44;
  const W = 780, H = 300 + tiers.length * rowHeight + 60;
  const { canvas, ctx } = baseTerminal(W, H);
  drawDigitalHeader(ctx, W, "VIP MARKETPLACE", "Live Access Rate Terminal");
  drawHUDCorners(ctx, W, H);

  const maxPrice = calculatePrice(30);
  const rowX = 90, rowW = W - 180;
  let y = 300;
  for (const [d, p] of tiers) {
    drawDigitalRow(ctx, rowX, y, rowW, `${d} DAY${d > 1 ? "S" : ""} ACCESS`, formatMoneyPlain(p), p / maxPrice, CYAN.bright);
    y += rowHeight;
  }

  ctx.textAlign = "center";
  ctx.font = "11px monospace";
  ctx.fillStyle = "rgba(75,227,255,0.5)";
  ctx.fillText("TAP {P}VIP BUY <DAYS>  //  OR REPLY WITH A NUMBER TO BUY", W / 2, y + 26);

  return saveCanvas(canvas, `vip_prices_${Date.now()}.png`);
}

function replyCard(message, bannerPath, onSent) {
  return message.reply({ attachment: fs.createReadStream(bannerPath) })
    .then((info) => {
      fs.unlink(bannerPath, () => {});
      if (typeof onSent === "function") {
        try { onSent(info); } catch (e) {}
      }
      return info;
    });
}

function registerBuyReply(info, uid) {
  if (!info || !info.messageID) return;
  if (!global.GoatBot || !global.GoatBot.onReply) return;
  global.GoatBot.onReply.set(info.messageID, {
    commandName: "vip",
    messageID: info.messageID,
    author: uid,
    type: "buyDays"
  });
}

async function performBuy({ days, uid, api, usersData, message }) {
  if (!days || isNaN(days) || days <= 0) {
    return message.reply(
      "• 📌 𝐔𝐬𝐞: {𝐩}𝐯𝐢𝐩 𝐛𝐮𝐲 <𝐝𝐚𝐲𝐬>\n" +
      "📌 𝐄𝐱𝐚𝐦𝐩𝐥𝐞: {𝐩}𝐯𝐢𝐩 𝐛𝐮𝐲 𝟏𝟓\n" +
      "💡 𝐘𝐨𝐮 𝐜𝐚𝐧 𝐛𝐮𝐲 𝐚𝐧𝐲 𝐧𝐮𝐦𝐛𝐞𝐫 𝐨𝐟 𝐝𝐚𝐲𝐬!"
    );
  }

  const price = calculatePrice(days);
  const user = await usersData.get(uid);
  const wallet = user.money || 0;

  if (wallet < price) {
    return message.reply(
      `• ❌ | 𝐈𝐧𝐬𝐮𝐟𝐟𝐢𝐜𝐢𝐞𝐧𝐭 𝐁𝐚𝐥𝐚𝐧𝐜𝐞!\n` +
      `╭‣ 𝐘𝐨𝐮𝐫 𝐁𝐚𝐥𝐚𝐧𝐜𝐞: ${formatMoneyPlain(wallet)}\n` +
      `╰‣ 𝐍𝐞𝐞𝐝𝐞𝐝: ${formatMoneyPlain(price - wallet)}`
    );
  }

  await usersData.set(uid, { money: wallet - price });
  const currentData = user.data || {};
  const currentExpire = currentData.vip?.expires || Date.now();
  const startTime = Math.max(currentExpire, Date.now());
  const expires = startTime + (days * DAY);

  await usersData.set(uid, { data: { ...currentData, vip: { expires } } });

  const userName = await usersData.getName(uid);
  const avatarImg = await fetchAvatarImage(uid, api, usersData);
  let bannerPath;
  try {
    bannerPath = await generateBuyBanner({
      name: userName,
      days,
      price,
      remaining: wallet - price,
      expires,
      avatarImg
    });
  } catch (e) {
    console.error("VIP banner render failed:", e);
  }

  if (bannerPath) return replyCard(message, bannerPath);
  return message.reply("• ✅ | 𝐕𝐈𝐏 𝐚𝐜𝐭𝐢𝐯𝐚𝐭𝐞𝐝.");
}

module.exports = {
  config: {
    name: "vip",
    version: "3.2",
    author: "Arafat",
    countDown: 5,
    role: 0,
    shortDescription: { en: "Premium VIP marketplace system" },
    longDescription: { en: "Buy VIP, admin add/remove, auto-expire, extend time — premium marketplace canvas cards, paginated list" },
    category: "economy",
    guide: {
      en: "{p}vip\n" +
          "{p}vip list [page]\n" +
          "{p}vip my\n" +
          "{p}vip buy <days>\n" +
          "{p}vip add <days> (reply/mention)\n" +
          "{p}vip remove (reply/mention)\n" +
          "{p}vip extend <days> (reply/mention)\n" +
          "\nTip: reply to the {p}vip price board (or the {p}vip buy usage message) with just a number of days to buy instantly."
    }
  },

  onStart: async function ({ api, event, args, usersData, message, role }) {
    const uid = event.senderID;

    const now = Date.now();
    if (cooldown.get(uid) && now - cooldown.get(uid) < 3000)
      return message.reply("• ⏳ 𝐏𝐥𝐞𝐚𝐬𝐞 𝐰𝐚𝐢𝐭 𝟑 𝐬𝐞𝐜𝐨𝐧𝐝𝐬.");
    cooldown.set(uid, now);

    const allUsers = await usersData.getAll();
    for (const u of allUsers) {
      if (u.data?.vip?.expires && u.data.vip.expires <= Date.now()) {
        await usersData.set(u.userID, { data: { ...u.data, vip: null } });
      }
    }

    if (args[0] === "my") {
      const user = await usersData.get(uid);
      const vipData = user.data?.vip;

      if (!vipData || !vipData.expires || vipData.expires <= Date.now()) {
        return message.reply(
          "• ❌ | 𝐘𝐨𝐮 𝐝𝐨𝐧'𝐭 𝐡𝐚𝐯𝐞 𝐚𝐧 𝐚𝐜𝐭𝐢𝐯𝐞 𝐕𝐈𝐏 𝐬𝐮𝐛𝐬𝐜𝐫𝐢𝐩𝐭𝐢𝐨𝐧."
        );
      }

      const timeLeftPlain = getTimeRemainingPlain(vipData.expires);
      const userName = await usersData.getName(uid);
      const avatarImg = await fetchAvatarImage(uid, api, usersData);

      let bannerPath;
      try {
        bannerPath = await generateStatusBanner({
          name: userName,
          expires: vipData.expires,
          timeLeft: timeLeftPlain,
          avatarImg
        });
      } catch (e) {
        console.error("VIP banner render failed:", e);
      }

      if (bannerPath) return replyCard(message, bannerPath);
      return message.reply("• ⚠️ | 𝐂𝐨𝐮𝐥𝐝 𝐧𝐨𝐭 𝐫𝐞𝐧𝐝𝐞𝐫 𝐲𝐨𝐮𝐫 𝐕𝐈𝐏 𝐜𝐚𝐫𝐝.");
    }

    if (args[0] === "list") {
      const freshUsers = await usersData.getAll();
      const listData = [];

      for (const u of freshUsers) {
        if (u.data?.vip?.expires && u.data.vip.expires > Date.now()) {
          const timeLeftPlain = getTimeRemainingPlain(u.data.vip.expires);
          listData.push({
            userID: u.userID,
            name: u.name || "User",
            expiresText: formatDatePlain(u.data.vip.expires),
            timeLeftText: timeLeftPlain.text,
            _sortDays: timeLeftPlain.days
          });
        }
      }

      if (!listData.length) return message.reply("• ⚠️ | 𝐍𝐨 𝐚𝐜𝐭𝐢𝐯𝐞 𝐕𝐈𝐏 𝐮𝐬𝐞𝐫𝐬 𝐟𝐨𝐮𝐧𝐝.");

      listData.sort((a, b) => b._sortDays - a._sortDays);

      const totalPages = Math.max(1, Math.ceil(listData.length / LIST_PAGE_SIZE));
      let page = parseInt(args[1]) || 1;
      if (page < 1) page = 1;
      if (page > totalPages) {
        return message.reply(`• ⚠️ | 𝐎𝐧𝐥𝐲 ${totalPages} 𝐩𝐚𝐠𝐞(𝐬) 𝐚𝐯𝐚𝐢𝐥𝐚𝐛𝐥𝐞. 𝐔𝐬𝐞: {𝐩}𝐯𝐢𝐩 𝐥𝐢𝐬𝐭 <𝐩𝐚𝐠𝐞>`);
      }

      const start = (page - 1) * LIST_PAGE_SIZE;
      const pageUsers = listData.slice(start, start + LIST_PAGE_SIZE);

      const avatarMap = await fetchAvatarImages(pageUsers.map(u => u.userID), api, usersData);
      for (const u of pageUsers) u.avatarImg = avatarMap[u.userID] || null;

      let bannerPath;
      try {
        bannerPath = await generateListBanner(pageUsers, page, totalPages, listData.length);
      } catch (e) {
        console.error("VIP banner render failed:", e);
      }

      if (bannerPath) return replyCard(message, bannerPath);
      return message.reply("• ⚠️ | 𝐂𝐨𝐮𝐥𝐝 𝐧𝐨𝐭 𝐫𝐞𝐧𝐝𝐞𝐫 𝐭𝐡𝐞 𝐕𝐈𝐏 𝐥𝐢𝐬𝐭.");
    }

    const getTargetID = () => {
      if (event.messageReply) return event.messageReply.senderID;
      if (Object.keys(event.mentions).length > 0) return Object.keys(event.mentions)[0];
      return null;
    };

    const isAdmin = role >= 2;

    if (args[0] === "add") {
      if (!isAdmin) return message.reply("• ❌ | 𝐎𝐧𝐥𝐲 𝐦𝐲 𝐚𝐝𝐦𝐢𝐧 𝐀𝐫𝐚𝐟𝐚𝐭 𝐜𝐚𝐧 𝐮𝐬𝐞 𝐭𝐡𝐢𝐬 𝐜𝐨𝐦𝐦𝐚𝐧𝐝!.");
      const days = parseInt(args[1]);
      if (!days || isNaN(days) || days <= 0) return message.reply("• ❌ 𝐏𝐥𝐞𝐚𝐬𝐞 𝐩𝐫𝐨𝐯𝐢𝐝𝐞 𝐯𝐚𝐥𝐢𝐝 𝐝𝐚𝐲𝐬.");

      const tid = getTargetID();
      if (!tid) return message.reply("• ❌ | 𝐑𝐞𝐩𝐥𝐲 𝐨𝐫 𝐦𝐞𝐧𝐭𝐢𝐨𝐧 𝐚 𝐮𝐬𝐞𝐫.");

      const user = await usersData.get(tid);
      const currentData = user.data || {};
      const currentExpire = currentData.vip?.expires || Date.now();
      const startTime = Math.max(currentExpire, Date.now());
      const expires = startTime + (days * DAY);

      await usersData.set(tid, { data: { ...currentData, vip: { expires } } });
      const name = await usersData.getName(tid);
      const avatarImg = await fetchAvatarImage(tid, api, usersData);

      let bannerPath;
      try {
        bannerPath = await generateAddBanner({ targetName: name, days, expires, avatarImg });
      } catch (e) {
        console.error("VIP banner render failed:", e);
      }

      if (bannerPath) return replyCard(message, bannerPath);
      return message.reply("• ✅ | 𝐕𝐈𝐏 𝐚𝐝𝐝𝐞𝐝.");
    }

    if (args[0] === "remove") {
      if (!isAdmin) return message.reply("• ❌ | 𝐎𝐧𝐥𝐲 𝐦𝐲 𝐚𝐝𝐦𝐢𝐧 𝐀𝐫𝐚𝐟𝐚𝐭 𝐜𝐚𝐧 𝐮𝐬𝐞 𝐭𝐡𝐢𝐬 𝐜𝐨𝐦𝐦𝐚𝐧𝐝!");
      const tid = getTargetID();
      if (!tid) return message.reply("• ❌ | 𝐑𝐞𝐩𝐥𝐲 𝐨𝐫 𝐦𝐞𝐧𝐭𝐢𝐨𝐧 𝐚 𝐮𝐬𝐞𝐫.");
      const user = await usersData.get(tid);
      await usersData.set(tid, { data: { ...user.data, vip: null } });
      const name = await usersData.getName(tid);
      const avatarImg = await fetchAvatarImage(tid, api, usersData);

      let bannerPath;
      try {
        bannerPath = await generateRemoveBanner({ targetName: name, avatarImg });
      } catch (e) {
        console.error("VIP banner render failed:", e);
      }

      if (bannerPath) return replyCard(message, bannerPath);
      return message.reply("• ✅ | 𝐕𝐈𝐏 𝐫𝐞𝐦𝐨𝐯𝐞𝐝.");
    }

    if (args[0] === "buy") {
      const days = parseInt(args[1]);
      if (!days || isNaN(days) || days <= 0) {
        const info = await message.reply(
          "• 📌 𝐔𝐬𝐞: {𝐩}𝐯𝐢𝐩 𝐛𝐮𝐲 <𝐝𝐚𝐲𝐬>\n" +
          "📌 𝐄𝐱𝐚𝐦𝐩𝐥𝐞: {𝐩}𝐯𝐢𝐩 𝐛𝐮𝐲 𝟏𝟓\n" +
          "💡 𝐎𝐫 𝐣𝐮𝐬𝐭 𝐫𝐞𝐩𝐥𝐲 𝐭𝐨 𝐭𝐡𝐢𝐬 𝐦𝐞𝐬𝐬𝐚𝐠𝐞 𝐰𝐢𝐭𝐡 𝐚 𝐧𝐮𝐦𝐛𝐞𝐫 𝐨𝐟 𝐝𝐚𝐲𝐬!"
        );
        registerBuyReply(info, uid);
        return;
      }

      return performBuy({ days, uid, api, usersData, message });
    }

    let priceBannerPath;
    try {
      priceBannerPath = generatePriceListBanner();
    } catch (e) {
      console.error("VIP banner render failed:", e);
    }

    if (priceBannerPath) {
      return replyCard(message, priceBannerPath, (info) => registerBuyReply(info, uid));
    }
    return message.reply("• ⚠️ | 𝐂𝐨𝐮𝐥𝐝 𝐧𝐨𝐭 𝐫𝐞𝐧𝐝𝐞𝐫 𝐭𝐡𝐞 𝐩𝐫𝐢𝐜𝐞 𝐛𝐨𝐚𝐫𝐝.");
  },

  onReply: async function ({ api, event, Reply, message, usersData }) {
    if (!Reply || Reply.type !== "buyDays") return;
    if (event.senderID !== Reply.author) return;

    const days = parseInt((event.body || "").trim());
    if (!days || isNaN(days) || days <= 0) {
      return message.reply("• ❌ | 𝐑𝐞𝐩𝐥𝐲 𝐰𝐢𝐭𝐡 𝐚 𝐯𝐚𝐥𝐢𝐝 𝐧𝐮𝐦𝐛𝐞𝐫 𝐨𝐟 𝐝𝐚𝐲𝐬, 𝐞.𝐠. 𝟏𝟓.");
    }

    return performBuy({ days, uid: event.senderID, api, usersData, message });
  }
};
