// server.js — Backend Postify (YouTube ➜ MP3 ➜ Google Drive)

import express from "express";
import cors from "cors";
import { google } from "googleapis";
import ytdl from "ytdl-core";
import fs from "fs";
import os from "os";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

// ---- Charger .env de façon robuste (même si lancé d'ailleurs)
import dotenv from "dotenv";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

// ---- App
const app = express();

// ========================
//  CORS — DOIT ÊTRE TOUT EN HAUT
// ========================
const ALLOWED_ORIGINS = [
  "https://charefsarah.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

app.use((req, res, next) => {
  res.header("Vary", "Origin");
  next();
});

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // Postman/cURL
      cb(null, ALLOWED_ORIGINS.includes(origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"], // ajouter "x-postify-key" si clé d'accès
    credentials: false, // true seulement si cookies
  })
);

// Laisse le package 'cors' répondre aux preflights
app.options("*", cors());

// ========================
//  PARSING
// ========================
app.use(express.json({ limit: "1mb" }));

// ========================
//  Sécurité par clé (optionnel, à activer plus tard)
// ========================
// const ACCESS_KEY = process.env.ACCESS_KEY || "";
// app.use((req, res, next) => {
//   if (req.method === "OPTIONS" || req.path === "/" || req.path === "/healthz") return next();
//   const key = req.get("x-postify-key");
//   if (!ACCESS_KEY || (key && key === ACCESS_KEY)) return next();
//   return res.status(401).json({ error: "Unauthorized" });
// });

// ========================
//  Lecture des credentials Google
// ========================
let rawCreds = process.env.GOOGLE_CREDENTIALS;
if (!rawCreds && process.env.GOOGLE_CREDENTIALS_B64) {
  try {
    rawCreds = Buffer.from(
      process.env.GOOGLE_CREDENTIALS_B64,
      "base64"
    ).toString("utf8");
  } catch (_) {}
}
if (!rawCreds) {
  console.error(
    "❌ Variable GOOGLE_CREDENTIALS (ou GOOGLE_CREDENTIALS_B64) manquante"
  );
  process.exit(1);
}

let creds;
try {
  creds = JSON.parse(rawCreds);
} catch (err) {
  console.error(
    "❌ Contenu de GOOGLE_CREDENTIALS invalide (JSON illisible):",
    err.message
  );
  process.exit(1);
}

const FOLDER_ID = process.env.FOLDER_ID;
if (!FOLDER_ID) {
  console.error(
    "❌ Variable FOLDER_ID manquante (ID de ton dossier Google Drive)"
  );
  process.exit(1);
}

// ---- Auth Google Drive
const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ["https://www.googleapis.com/auth/drive.file"],
});
const drive = google.drive({ version: "v3", auth });

// Petit helper: nom de fichier safe
function safeName(str, fallback = "audio") {
  const cleaned = (str || fallback)
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

// Logger les requêtes entrantes
app.use((req, _res, next) => {
  console.log(`Requête reçue : ${req.method} ${req.url}`);
  next();
});

// GET / : ping
app.get("/", (_req, res) => {
  res.type("text/plain").send("Serveur Postify opérationnel ✅");
});

// GET /healthz : diagnostic variables
app.get("/healthz", (_req, res) => {
  res.json({
    has_GOOGLE_CREDENTIALS: !!(
      process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_CREDENTIALS_B64
    ),
    has_FOLDER_ID: !!process.env.FOLDER_ID,
  });
});

// POST /download { url, title? } -> upload sur Drive et renvoie lien
app.post("/download", async (req, res) => {
  const { url, title } = req.body || {};
  if (!url || !ytdl.validateURL(url)) {
    return res.status(400).json({ error: "URL YouTube invalide" });
  }

  try {
    const info = await ytdl.getInfo(url).catch(() => null);
    const ytTitle = info?.videoDetails?.title || "audio";
    const finalTitle = safeName(title || ytTitle);
    const tmpFile = path.join(os.tmpdir(), `${finalTitle}.mp3`);

    // Transcodage en MP3 (par défaut 128 kbps)
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

    // Upload Google Drive
    const fileMeta = { name: `${finalTitle}.mp3`, parents: [FOLDER_ID] };
    const media = {
      mimeType: "audio/mpeg",
      body: fs.createReadStream(tmpFile),
    };

    const uploaded = await drive.files.create({
      resource: fileMeta,
      media,
      fields: "id, name, webContentLink, webViewLink",
    });

    // Nettoyage fichier temporaire
    try {
      fs.unlinkSync(tmpFile);
    } catch (_) {}

    // Rendre le fichier public (lecture)
    try {
      await drive.permissions.create({
        fileId: uploaded.data.id,
        requestBody: { role: "reader", type: "anyone" },
      });
    } catch (e) {
      // si le dossier est déjà public, c'est ok
    }

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

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Postify server listening on port ${PORT}`);
});
