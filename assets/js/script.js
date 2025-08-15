// Bouton téléchargement depuis YouTube
const ytBtn = document.getElementById("downloadYtBtn");
ytBtn.onclick = async () => {
  const url = document.getElementById("ytUrl").value.trim();
  const title = document.getElementById("ytTitle").value.trim() || "Sans titre";
  const artist = document.getElementById("ytArtist").value.trim() || "";

  if (!url) {
    alert("Merci d'entrer une URL YouTube");
    return;
  }

  try {
    const res = await fetch(
      `${BACKEND_URL}/download?url=${encodeURIComponent(url)}`
    );
    if (!res.ok) throw new Error("Erreur lors du téléchargement");
    const blob = await res.blob();

    const track = {
      title,
      artist,
      type: "audio",
      audioBlob: blob,
      coverBlob: null,
      playlists:
        state.playlists.includes(state.playlist) && state.playlist !== "Tous"
          ? [state.playlist]
          : [],
    };

    await addTrack(track);
    await refresh();

    document.getElementById("ytUrl").value = "";
    document.getElementById("ytTitle").value = "";
    document.getElementById("ytArtist").value = "";
    alert("Titre ajouté à votre bibliothèque !");
  } catch (err) {
    console.error(err);
    alert("Impossible de récupérer l'audio depuis YouTube");
  }
};
