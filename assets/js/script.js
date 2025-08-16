// ========================
//  CONFIG
// ========================
// Tu peux surcharger en sauvegardant dans localStorage:
// localStorage.setItem('postify_backend_url','https://ton-service.up.railway.app')
let BACKEND_URL =
  localStorage.getItem("postify_backend_url") ||
  "postify-production-a86f.up.railway.app";

// ========================
//  STATE & AUDIO
// ========================
const state = {
  tracks: [], // [{id,title,artist,type:'audio'|'stream',audioBlob?,streamUrl?,coverBlob?,playlists:[]}...]
  playlists: ["Tous"],
  playlist: "Tous",
  query: "",
};

const els = {
  // grille & filtres
  grid: document.getElementById("grid"),
  search: document.getElementById("search"),
  playlistFilter: document.getElementById("playlistFilter"),
  playlistList: document.getElementById("playlistList"),

  // import local
  audioFile: document.getElementById("audioFile"),
  coverFile: document.getElementById("coverFile"),
  trackTitle: document.getElementById("trackTitle"),
  trackArtist: document.getElementById("trackArtist"),
  saveTrackBtn: document.getElementById("saveTrackBtn"),

  // playlists
  newPlaylistName: document.getElementById("newPlaylistName"),
  createPlaylistBtn: document.getElementById("createPlaylistBtn"),

  // export/import
  exportBtn: document.getElementById("exportBtn"),
  importJson: document.getElementById("importJson"),

  // player
  playerBar: document.querySelector(".player"),
  playerCover: document.getElementById("playerCover"),
  playerTitle: document.getElementById("playerTitle"),
  curTime: document.getElementById("curTime"),
  durTime: document.getElementById("durTime"),
  prevBtn: document.getElementById("prevBtn"),
  playPauseBtn: document.getElementById("playPauseBtn"),
  nextBtn: document.getElementById("nextBtn"),
  stopBtn: document.getElementById("stopBtn"),

  // modal YouTube
  openYtModalBtn: document.getElementById("openYtModal"),
  ytModal: document.getElementById("ytModal"),
  mYtUrl: document.getElementById("mYtUrl"),
  mTitle: document.getElementById("mTitle"),
  mArtist: document.getElementById("mArtist"),
  mCover: document.getElementById("mCover"),
  mPlaylist: document.getElementById("mPlaylist"),
  mNewPlaylist: document.getElementById("mNewPlaylist"),
  mMsg: document.getElementById("mMsg"),
  mSubmit: document.getElementById("mSubmit"),
};

const audio = new Audio();
audio.preload = "metadata";

let queue = []; // tableau d'ids (track.id)
let queueIndex = -1;

// ========================
//  INDEXEDDB
// ========================
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open("postify-db", 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("tracks")) {
        const s = db.createObjectStore("tracks", { keyPath: "id" });
        s.createIndex("by_title", "title", { unique: false });
        s.createIndex("by_created", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function dbGetAllTracks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tracks", "readonly");
    const req = tx.objectStore("tracks").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbPutTrack(track) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tracks", "readwrite");
    tx.objectStore("tracks").put(track);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDeleteTrack(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tracks", "readwrite");
    tx.objectStore("tracks").delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbGetMeta(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readonly");
    const req = tx.objectStore("meta").get(key);
    req.onsuccess = () => resolve(req.result?.value);
    req.onerror = () => reject(req.error);
  });
}
async function dbSetMeta(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put({ key, value });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ========================
//  UTILS
// ========================
const uuid = () =>
  "t_" +
  Date.now().toString(36) +
  "_" +
  Math.floor(Math.random() * 1e6).toString(36);
const fmtTime = (s) => {
  if (!isFinite(s)) return "0:00";
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  const r = (s % 60).toString().padStart(2, "0");
  return `${m}:${r}`;
};
const blobUrlFrom = (b) => (b ? URL.createObjectURL(b) : "");
const fileToBlob = (file) =>
  new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () =>
      res(
        new Blob([fr.result], { type: file.type || "application/octet-stream" })
      );
    fr.onerror = () => rej(fr.error);
    fr.readAsArrayBuffer(file);
  });

function filterTracks() {
  let list = state.tracks.slice();
  if (state.playlist && state.playlist !== "Tous") {
    list = list.filter((t) => (t.playlists || []).includes(state.playlist));
  }
  const q = state.query.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (t) =>
        (t.title || "").toLowerCase().includes(q) ||
        (t.artist || "").toLowerCase().includes(q)
    );
  }
  return list;
}

// ========================
//  RENDER UI
// ========================
function renderPlaylists() {
  // colonne gauche
  els.playlistList.innerHTML = "";
  for (const name of state.playlists) {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = name;
    btn.style.width = "100%";
    btn.style.textAlign = "left";
    if (name === state.playlist) btn.style.background = "#1e2630";
    btn.onclick = () => {
      state.playlist = name;
      els.playlistFilter.value = name;
      refresh();
    };
    els.playlistList.appendChild(btn);
  }
  // select toolbar
  els.playlistFilter.innerHTML = "";
  for (const name of state.playlists) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === state.playlist) opt.selected = true;
    els.playlistFilter.appendChild(opt);
  }
}

function renderGrid() {
  const list = filterTracks();
  els.grid.innerHTML = "";
  if (!list.length) {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = "Aucun titre ici pour le moment.";
    els.grid.appendChild(div);
    return;
  }

  list.forEach((t, i) => {
    const card = document.createElement("div");
    card.className = "card";

    const cover = document.createElement("div");
    cover.className = "cover";
    const img = document.createElement("img");
    img.alt = "";
    img.src = t.coverBlob ? blobUrlFrom(t.coverBlob) : "";
    cover.appendChild(img);

    cover.onclick = () => {
      queue = list.map((x) => x.id);
      queueIndex = i;
      playCurrent();
    };

    const meta = document.createElement("div");
    meta.className = "meta";

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = t.title || "Sans titre";

    const sub = document.createElement("div");
    sub.className = "muted";
    const tag =
      t.type === "youtube"
        ? "YouTube"
        : t.type === "stream"
        ? "Drive"
        : "Audio";
    sub.textContent = `${t.artist || "—"} · ${tag}`;

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "6px";
    row.style.marginTop = "8px";

    const playBtn = document.createElement("button");
    playBtn.textContent = "▶ Lire";
    playBtn.onclick = () => {
      queue = list.map((x) => x.id);
      queueIndex = i;
      playCurrent();
    };

    const delBtn = document.createElement("button");
    delBtn.textContent = "🗑 Supprimer";
    delBtn.onclick = async () => {
      await dbDeleteTrack(t.id);
      state.tracks = state.tracks.filter((x) => x.id !== t.id);
      refresh();
    };

    row.appendChild(playBtn);
    row.appendChild(delBtn);

    meta.appendChild(title);
    meta.appendChild(sub);
    meta.appendChild(row);

    card.appendChild(cover);
    card.appendChild(meta);
    els.grid.appendChild(card);
  });
}

function refresh() {
  renderPlaylists();
  renderGrid();
  updatePlayBtn();
}

// ========================
//  LECTURE
// ========================
function updatePlayBtn() {
  els.playPauseBtn.textContent = audio.paused ? "▶" : "⏸";
}

function playCurrent() {
  if (queueIndex < 0 || queueIndex >= queue.length) return;
  const id = queue[queueIndex];
  const t = state.tracks.find((x) => x.id === id);
  if (!t) return;

  const coverUrl = t.coverBlob ? blobUrlFrom(t.coverBlob) : "";
  els.playerCover.src = coverUrl || "";
  els.playerTitle.textContent = `${t.title || "Sans titre"}${
    t.artist ? " — " + t.artist : ""
  }`;
  els.playerBar.hidden = false;

  if (t.type === "stream") {
    audio.src = t.streamUrl;
    audio.play();
    updatePlayBtn();
    return;
  }
  // audio local
  const url = blobUrlFrom(t.audioBlob);
  audio.src = url;
  audio.play();
  updatePlayBtn();
}

els.playPauseBtn.onclick = () => {
  if (!audio.src) return;
  if (audio.paused) audio.play();
  else audio.pause();
  updatePlayBtn();
};
els.stopBtn.onclick = () => {
  audio.pause();
  audio.currentTime = 0;
  updatePlayBtn();
};
els.prevBtn.onclick = () => {
  if (!queue.length) return;
  queueIndex = (queueIndex - 1 + queue.length) % queue.length;
  playCurrent();
};
els.nextBtn.onclick = () => {
  if (!queue.length) return;
  queueIndex = (queueIndex + 1) % queue.length;
  playCurrent();
};

audio.addEventListener("timeupdate", () => {
  els.curTime.textContent = fmtTime(audio.currentTime);
});
audio.addEventListener("loadedmetadata", () => {
  els.durTime.textContent = fmtTime(audio.duration);
});
audio.addEventListener("ended", () => {
  if (!queue.length) return;
  queueIndex = (queueIndex + 1) % queue.length;
  playCurrent();
});

// ========================
//  AJOUT / IMPORT LOCAL
// ========================
async function addTrack(track) {
  track.id = track.id || uuid();
  track.createdAt = track.createdAt || Date.now();
  track.playlists = track.playlists || [];
  if (!track.playlists.length && state.playlist !== "Tous") {
    track.playlists = [state.playlist];
  }
  await dbPutTrack(track);
  state.tracks.push(track);
}

els.saveTrackBtn?.addEventListener("click", async () => {
  const f = els.audioFile?.files?.[0];
  if (!f) {
    alert("Choisis un fichier audio/vidéo.");
    return;
  }
  const cover = els.coverFile?.files?.[0];

  const audioBlob = await fileToBlob(f);
  const coverBlob = cover ? await fileToBlob(cover) : null;

  const t = {
    title: (els.trackTitle.value || f.name || "Sans titre").replace(
      /\.[a-z0-9]+$/i,
      ""
    ),
    artist: els.trackArtist.value || "",
    type: "audio",
    audioBlob,
    coverBlob,
    playlists:
      state.playlist && state.playlist !== "Tous" ? [state.playlist] : [],
  };

  await addTrack(t);
  els.trackTitle.value = "";
  els.trackArtist.value = "";
  if (els.audioFile) els.audioFile.value = "";
  if (els.coverFile) els.coverFile.value = "";
  refresh();
  alert("Titre importé !");
});

// ========================
//  MODAL YOUTUBE (URL + titre + cover + playlist)
// ========================
function openModal() {
  // Remplit la liste des playlists (— Aucune —)
  const sel = els.mPlaylist;
  if (!sel) return;
  sel.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— Aucune —";
  sel.appendChild(none);
  for (const p of state.playlists) {
    if (p === "Tous") continue;
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    if (state.playlist !== "Tous" && p === state.playlist) opt.selected = true;
    sel.appendChild(opt);
  }
  els.mYtUrl.value = "";
  els.mTitle.value = "";
  els.mArtist.value = "";
  if (els.mCover) els.mCover.value = "";
  els.mNewPlaylist.value = "";
  els.mMsg.textContent = "";
  els.ytModal.hidden = false;
  els.ytModal.setAttribute("aria-hidden", "false");
  els.mYtUrl.focus();
}
function closeModal() {
  els.ytModal.setAttribute("aria-hidden", "true");
  els.ytModal.hidden = true;
}

els.openYtModalBtn?.addEventListener("click", openModal);
els.ytModal?.addEventListener("click", (e) => {
  if (
    e.target.classList.contains("modal__overlay") ||
    e.target.dataset.close !== undefined
  )
    closeModal();
});
document.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    els.ytModal &&
    els.ytModal.getAttribute("aria-hidden") === "false"
  )
    closeModal();
});

els.mSubmit?.addEventListener("click", async () => {
  const url = (els.mYtUrl.value || "").trim();
  const title = (els.mTitle.value || "").trim();
  const artist = (els.mArtist.value || "").trim();
  const chosen = els.mPlaylist.value;
  const newP = (els.mNewPlaylist.value || "").trim();

  if (!url) {
    els.mMsg.textContent = "Entre une URL YouTube.";
    return;
  }

  els.mSubmit.disabled = true;
  els.mSubmit.textContent = "Téléchargement…";
  els.mMsg.textContent = "";

  try {
    // 1) backend => upload Drive => lien
    const resp = await fetch(`${BACKEND_URL}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, title }),
    });
    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }
    const data = await resp.json(); // { directLink, title, ... }

    // 2) cover (optionnelle)
    let coverBlob = null;
    const f = els.mCover?.files?.[0];
    if (f) coverBlob = await fileToBlob(f);

    // 3) playlists
    const pl = [];
    if (chosen) pl.push(chosen);
    if (newP) {
      if (!state.playlists.includes(newP)) {
        state.playlists.push(newP);
        await savePlaylists();
      }
      pl.push(newP);
    }
    if (!pl.length && state.playlist && state.playlist !== "Tous") {
      pl.push(state.playlist);
    }

    // 4) enregistre le track "stream"
    const track = {
      title: title || data.title || "Sans titre",
      artist,
      type: "stream",
      streamUrl: data.directLink,
      coverBlob,
      playlists: pl,
    };
    await addTrack(track);
    await refresh();

    closeModal();
    alert("Ajouté à ta bibliothèque (fichier sur Drive) !");
  } catch (err) {
    console.error("Erreur lors de la requête :", err);
    els.mMsg.textContent = "Échec du téléchargement / upload.";
  } finally {
    els.mSubmit.disabled = false;
    els.mSubmit.textContent = "Télécharger & Ajouter";
  }
});

// ========================
//  PLAYLISTS
// ========================
async function ensurePlaylistsLoaded() {
  const saved = await dbGetMeta("playlists");
  if (saved && Array.isArray(saved) && saved.length) {
    const rest = saved.filter((x) => x !== "Tous");
    state.playlists = ["Tous", ...rest];
  } else {
    state.playlists = ["Tous"];
  }
  if (!state.playlists.includes(state.playlist)) state.playlist = "Tous";
}
async function savePlaylists() {
  const uniq = Array.from(new Set(state.playlists));
  await dbSetMeta("playlists", uniq);
}
els.createPlaylistBtn?.addEventListener("click", async () => {
  const name = (els.newPlaylistName.value || "").trim();
  if (!name) return;
  if (name.toLowerCase() === "tous") {
    alert("Playlist réservée.");
    return;
  }
  if (!state.playlists.includes(name)) {
    state.playlists.push(name);
    await savePlaylists();
    els.newPlaylistName.value = "";
    refresh();
  }
});
els.playlistFilter?.addEventListener("change", () => {
  state.playlist = els.playlistFilter.value;
  refresh();
});

// ========================
//  EXPORT / IMPORT JSON
// ========================
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}
function dataURLToBlob(dataURL) {
  const [meta, b64] = dataURL.split(",");
  const mime =
    (meta.match(/data:(.*?);base64/) || [])[1] || "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

els.exportBtn?.addEventListener("click", async () => {
  const out = [];
  for (const t of state.tracks) {
    const item = {
      id: t.id,
      title: t.title,
      artist: t.artist,
      type: t.type,
      playlists: t.playlists || [],
      createdAt: t.createdAt || Date.now(),
    };
    if (t.type === "audio" && t.audioBlob) {
      item.audioDataURL = await blobToDataURL(t.audioBlob);
    }
    if (t.coverBlob) {
      item.coverDataURL = await blobToDataURL(t.coverBlob);
    }
    if (t.type === "stream") {
      item.streamUrl = t.streamUrl;
    }
    out.push(item);
  }
  const data = JSON.stringify(
    { tracks: out, playlists: state.playlists },
    null,
    0
  );
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "postify-export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

els.importJson?.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const text = await f.text();
    const data = JSON.parse(text);
    if (Array.isArray(data.playlists) && data.playlists.length) {
      state.playlists = Array.from(
        new Set(["Tous", ...data.playlists.filter((x) => x !== "Tous")])
      );
      await savePlaylists();
    }
    if (Array.isArray(data.tracks)) {
      for (const it of data.tracks) {
        const t = {
          id: it.id || uuid(),
          title: it.title || "Sans titre",
          artist: it.artist || "",
          type: it.type || "audio",
          playlists: it.playlists || [],
          createdAt: it.createdAt || Date.now(),
        };
        if (it.type === "audio" && it.audioDataURL) {
          t.audioBlob = dataURLToBlob(it.audioDataURL);
        }
        if (it.coverDataURL) {
          t.coverBlob = dataURLToBlob(it.coverDataURL);
        }
        if (it.type === "stream" && it.streamUrl) {
          t.streamUrl = it.streamUrl;
        }
        await dbPutTrack(t);
      }
      state.tracks = await dbGetAllTracks();
      refresh();
      alert("Bibliothèque importée !");
    }
  } catch (err) {
    console.error(err);
    alert("Import invalide.");
  } finally {
    e.target.value = "";
  }
});

// ========================
//  SEARCH
// ========================
els.search?.addEventListener("input", () => {
  state.query = els.search.value || "";
  renderGrid();
});

// ========================
//  INIT
// ========================
(async function init() {
  await openDB();
  await ensurePlaylistsLoaded();
  state.tracks = await dbGetAllTracks();
  if (!state.playlists.includes("Tous")) state.playlists.unshift("Tous");
  refresh();
})();
