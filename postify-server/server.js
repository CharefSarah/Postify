// server.js — Backend Postify (YouTube ➜ MP3 ➜ Google Drive)
import express from "express";
import { google } from "googleapis";
import ytdl from "ytdl-core";
import fs from "fs";
import os from "os";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();

/* ===========================
   CORS — EN DUR, SANS DOUTE
   =========================== */
const FRONT_ORIGIN = "https://charefsarah.github.io"; // ton front

function setCORS(res) {
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", FRONT_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // PAS de credentials/cookies => pas besoin d'Allow-Credentials
}

// CORS sur toutes les réponses
app.use((req, res, next) => {
  setCORS(res);
  if (req.method === "OPTIONS") {
    // Réponse immédiate aux preflights
    return res.status(204).end();
  }
  next();
});

// Parser JSON
app.use(express.json({ limit: "1mb" }));

/* ===========================
   ENV GOOGLE
   =========================== */
let rawCreds = process.env.GOOGLE_CREDENTIALS;
if (!rawCreds && process.env.GOOGLE_CREDENTIALS_B64) {
  try {
    rawCreds = Buffer.from(
      process.env.GOOGLE_CREDENTIALS_B64,
      "base64"
    ).toString("utf8");
  } catch {}
}
if (!rawCreds) {
  console.error("❌ GOOGLE_CREDENTIALS(_B64) manquant");
  process.exit(1);
}

let creds;
try {
  creds = JSON.parse(rawCreds);
} catch (e) {
  console.error("❌ GOOGLE_CREDENTIALS invalide:", e.message);
  process.exit(1);
}

const FOLDER_ID = process.env.FOLDER_ID;
if (!FOLDER_ID) {
  console.error("❌ FOLDER_ID manquant");
  process.exit(1);
}

/* ===========================
   Google Drive
   =========================== */
const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ["https://www.googleapis.com/auth/drive.file"],
});
const drive = google.drive({ version: "v3", auth });

function safeName(str, fallback = "audio") {
  const cleaned = (str || fallback)
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

/* ===========================
   Logs
   =========================== */
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/* ===========================
   Routes
   =========================== */

// Ping
app.get("/", (_req, res) => {
  setCORS(res);
  res.type("text/plain").send("Serveur Postify opérationnel ✅");
});

// Healthz
app.get("/healthz", (_req, res) => {
  setCORS(res);
  res.json({
    has_GOOGLE_CREDENTIALS: !!(
      process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_CREDENTIALS_B64
    ),
    has_FOLDER_ID: !!process.env.FOLDER_ID,
    version: "cors-hammer-1",
  });
});

// Download
app.post("/download", async (req, res) => {
  setCORS(res);
  const { url, title } = req.body || {};
  if (!url || !ytdl.validateURL(url)) {
    return res.status(400).json({ error: "URL YouTube invalide" });
  }

  try {
    const info = await ytdl.getInfo(url).catch(() => null);
    const ytTitle = info?.videoDetails?.title || "audio";
    const finalTitle = safeName(title || ytTitle);
    const tmpFile = path.join(os.tmpdir(), `${finalTitle}.mp3`);

    const audioStream = ytdl(url, {
      quality: "highestaudio",
      filter: "audioonly",
    });

    await new Promise((resolve, reject) => {
      ffmpeg(audioStream)
        .setFfmpegPath(ffmpegPath)
        .audioCodec("libmp3lame")
        .audioBitrate(128)
        .format("mp3")
        .on("error", reject)
        .on("end", resolve)
        .save(tmpFile);
    });

    const fileMeta = { name: `${finalTitle}.mp3`, parents: [FOLDER_ID] };
    const media = {
      mimeType: "audio/mpeg",
      body: fs.createReadStream(tmpFile),
    };

    const uploaded = await drive.files.create({
      resource: fileMeta,
      media,
      fields: "id,name,webContentLink,webViewLink",
    });

    try {
      fs.unlinkSync(tmpFile);
    } catch {}

    try {
      await drive.permissions.create({
        fileId: uploaded.data.id,
        requestBody: { role: "reader", type: "anyone" },
      });
    } catch {}

    const id = uploaded.data.id;
    const directLink = `https://drive.google.com/uc?export=download&id=${id}`;

    return res.json({
      success: true,
      id,
      name: uploaded.data.name,
      title: ytTitle,
      directLink,
      webViewLink: uploaded.data.webViewLink,
    });
  } catch (err) {
    console.error("⛔ Erreur /download :", err?.message || err);
    return res.status(500).json({ error: "Erreur téléchargement/upload" });
  }
});

// 404 CATCH-ALL avec CORS (important pour les preflights qui tombent dans un trou)
app.use((req, res) => {
  setCORS(res);
  res.status(404).json({ error: "Not Found" });
});

/* ===========================
   Start
   =========================== */
const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Postify server listening on port ${PORT}`);
});
