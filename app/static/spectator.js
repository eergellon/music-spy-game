const params = new URLSearchParams(window.location.search);
const roomCode = params.get("room_code") || "";

const videoTitle = document.getElementById("videoTitle");
const videoPlayerName = document.getElementById("videoPlayerName");
const videoArea = document.getElementById("videoArea");

let lastKey = "";

async function loadSpectatorState() {
  if (!roomCode) return;

  try {
    const response = await fetch(`/spectator_state?room_code=${encodeURIComponent(roomCode)}`);
    const data = await response.json();

    if (data.error) {
      videoTitle.textContent = "Ошибка";
      videoPlayerName.textContent = "";
      videoArea.innerHTML = `<div class="placeholder">${escapeHtml(data.error)}</div>`;
      return;
    }

    renderSpectatorState(data);
  } catch (error) {
    videoTitle.textContent = "Ошибка соединения";
    videoPlayerName.textContent = "";
  }
}

function renderSpectatorState(state) {
  if (state.phase !== "playing" || !state.current_submission) {
    lastKey = "";
    videoTitle.textContent = "Ждём следующий ролик";
    videoPlayerName.textContent = "";
    videoArea.innerHTML = `<div class="placeholder">Сейчас ничего не играет</div>`;
    return;
  }

  const submission = state.current_submission;
  const key = `${submission.video_id}:${submission.start_seconds}`;

  videoTitle.textContent = submission.title || "Без названия";
  videoPlayerName.textContent = state.current_player_name
    ? `Сейчас играет: ${state.current_player_name}`
    : "";

  if (key !== lastKey) {
    lastKey = key;
    videoArea.innerHTML = `
      <iframe
        src="https://www.youtube.com/embed/${encodeURIComponent(submission.video_id)}?start=${submission.start_seconds}&autoplay=1"
        allow="autoplay; encrypted-media"
        allowfullscreen
      ></iframe>
    `;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadSpectatorState();
setInterval(loadSpectatorState, 1000);