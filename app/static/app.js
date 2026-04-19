let roomCode = "";
let playerName = "";
let socket = null;
let lastState = null;
let lastTopicChangeEventId = 0;
let draftVideoUrl = "";
let draftTimecode = "";

const authScreen = document.getElementById("authScreen");
const gameScreen = document.getElementById("gameScreen");
const appShell = document.getElementById("appShell");
const authMessage = document.getElementById("authMessage");
const createdRoomBox = document.getElementById("createdRoomBox");
const createdRoomCode = document.getElementById("createdRoomCode");

function setAuthMessage(text, isError = true) {
  authMessage.textContent = text || "";
  authMessage.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function wsProtocol() {
  return window.location.protocol === "https:" ? "wss" : "ws";
}

async function apiGet(url) {
  const response = await fetch(url);
  return response.json();
}

async function createRoom() {
  playerName = document.getElementById("nameInput").value.trim();
  if (!playerName) {
    setAuthMessage("Введите ник.");
    return;
  }

  const data = await apiGet(`/create_room?name=${encodeURIComponent(playerName)}`);
  if (data.error) {
    setAuthMessage(data.error);
    return;
  }

  roomCode = data.room_code;
  createdRoomCode.textContent = roomCode;
  createdRoomBox.classList.remove("hidden");

  const joinData = await apiGet(
    `/join_room?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`
  );
  if (joinData.error) {
    setAuthMessage(joinData.error);
    return;
  }

  afterJoin();
}

async function joinRoom() {
  playerName = document.getElementById("nameInput").value.trim();
  roomCode = document.getElementById("roomCodeInput").value.trim();

  if (!playerName || !roomCode) {
    setAuthMessage("Введите ник и код комнаты.");
    return;
  }

  const data = await apiGet(
    `/join_room?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`
  );
  if (data.error) {
    setAuthMessage(data.error);
    return;
  }

  afterJoin();
}

function afterJoin() {
  authScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  connectWs();
}

function connectWs() {
  const url = `${wsProtocol()}://${location.host}/ws/${roomCode}/${encodeURIComponent(playerName)}`;
  socket = new WebSocket(url);

  socket.onopen = () => socket.send("ping");
  socket.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "state") {
      lastState = payload.data;
      renderState(payload.data);
    }
  };
  socket.onclose = () => {
    setTimeout(connectWs, 1500);
  };
}

function renderState(state) {
  captureDraftInputs();
  appShell.innerHTML = renderApp(state);
  bindDraftInputs();
  bindPhaseActions(state);
  maybePlayTopicChangeSound(state);
}

function maybePlayTopicChangeSound(state) {
  const eventId = state.topic_change_event_id || 0;

  if (eventId > lastTopicChangeEventId) {
    const audio = new Audio("/static/metalpiplesound.mp3");
    audio.play().catch(() => {});
  }

  lastTopicChangeEventId = eventId;
}

function renderApp(state) {
  return `
    <header class="topbar card">
      <div class="topbar-left">
        <div class="eyebrow">Комната ${escapeHtml(state.room_code)}</div>
        <h2 class="topbar-title">${escapeHtml(state.phase_title)}</h2>
        <div class="status-line">${escapeHtml(state.status_text || "")}</div>
      </div>

      <div class="topbar-right">
        <div class="meta-pill">
          <span class="meta-label">Ты</span>
          <span class="meta-value">${escapeHtml(state.you)}</span>
        </div>
        <div class="meta-pill">
          <span class="meta-label">Раунд</span>
          <span class="meta-value">${state.round_number}</span>
        </div>
        <div class="meta-pill">
          <span class="meta-label">Хост</span>
          <span class="meta-value">${escapeHtml(state.host)}</span>
        </div>
        ${
          state.is_host && state.phase === "preparation"
            ? `<button id="rerollTopicBtn" class="ghost">Другая тема</button>`
            : ``
        }
        ${
          state.is_host
            ? `<button id="openSpectatorBtn" class="secondary">Окно зрителя</button>`
            : ``
        }
      </div>
    </header>

    <main class="layout layout-${escapeHtml(state.phase)}">
      <section class="scene-column">
        ${renderScene(state)}
      </section>

      <aside class="context-column">
        ${renderContextPanel(state)}
      </aside>
    </main>
  `;
}

function renderScene(state) {
  switch (state.phase) {
    case "lobby":
      return renderLobbyScene(state);
    case "preparation":
      return renderPreparationScene(state);
    case "playing":
      return renderPlayingScene(state);
    case "spy_insert_window":
      return renderSpyWindowScene(state);
    case "voting":
      return renderVotingScene(state);
    case "reveal":
      return renderRevealScene(state);
    default:
      return `
        <div class="card phase-card">
          <div class="phase-title">Неизвестная фаза</div>
        </div>
      `;
  }
}

function renderContextPanel(state) {
  if (state.phase === "playing") {
    return `
      <div class="card side-card">
        <h3>Сейчас</h3>
        <div class="mini-stat">
          <span>Игрок</span>
          <strong>${escapeHtml(state.current_player_name || "—")}</strong>
        </div>
        <div class="mini-stat">
          <span>Прогресс</span>
          <strong>${state.queue_played.length} / ${state.queue_total}</strong>
        </div>
        ${renderPlayersCompact(state.players, state)}
      </div>
    `;
  }

  if (state.phase === "voting") {
    return `
      <div class="card side-card">
        <h3>Голосование</h3>
        <div class="target-box">
          <div class="muted small">Цель</div>
          <div class="target-name">${escapeHtml(state.voting_target || "—")}</div>
        </div>

        <div class="progress-panel">
          <div class="progress-header">
            <span>Голосов получено</span>
            <strong>${state.vote_progress_count} / ${state.vote_progress_total}</strong>
          </div>
          <div class="progress-bar">
            <div
              class="progress-fill"
              style="width: ${getVoteProgress(state)}%"
            ></div>
          </div>
        </div>
      </div>

      <div class="card side-card">
        <h3>Игроки</h3>
        ${renderPlayersCompact(state.players, state)}
      </div>
    `;
  }

  if (state.phase === "reveal") {
    return `
      <div class="card side-card">
        <h3>Игроки</h3>
        ${renderPlayersDetailed(state.players, state)}
      </div>

      <div class="card side-card">
        <details class="score-log-details">
          <summary class="score-log-summary">Лог очков</summary>
          <div class="score-log-list">
            ${(state.score_events && state.score_events.length)
              ? state.score_events.map((item) => `<div class="score-log-item">${escapeHtml(item)}</div>`).join("")
              : `<div class="muted">Пока пусто.</div>`}
          </div>
        </details>
      </div>

      <div class="card side-card">
        <h3>Последнее голосование</h3>
        <div class="muted">${escapeHtml(state.last_vote_result_text || "Пока нет голосований.")}</div>
      </div>
    `;
  }

  return `
    <div class="card side-card">
      <h3>Игроки</h3>
      ${renderPlayersDetailed(state.players, state)}
    </div>
  `;
}

function renderLobbyScene(state) {
  return `
    <div class="card phase-card hero-phase">
      <div class="phase-title">Музыкальный шпион</div>

      <div class="room-code-panel">
        <div class="muted small">Код комнаты</div>
        <div class="big-room-code">${escapeHtml(state.room_code)}</div>
      </div>

      <div class="stats-row">
        <div class="stat-card">
          <span class="stat-label">Игроков</span>
          <span class="stat-value">${state.players.length}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Хост</span>
          <span class="stat-value">${escapeHtml(state.host)}</span>
        </div>
      </div>

      <div class="primary-action">
        ${
          state.is_host
            ? `<button id="startRoundBtn" class="primary large">Начать раунд</button>`
            : `<div class="waiting-banner">Ждём хоста.</div>`
        }
      </div>
    </div>
  `;
}

function renderPreparationScene(state) {
  const isSpy = state.role === "spy";

  return `
    <div class="card phase-card">
      <div class="phase-title">Подготовка</div>

      <div class="identity-panel ${isSpy ? "identity-spy" : "identity-player"}">
        ${
          isSpy
            ? `
              <div class="identity-label">Роль</div>
              <div class="identity-main danger">Ты шпион</div>
              <div class="identity-subtext">Жди первый ролик.</div>
            `
            : `
              <div class="identity-label">Тема</div>
              <div class="identity-main good">${escapeHtml(state.topic || "—")}</div>
            `
        }
      </div>

      <div class="progress-panel">
        <div class="progress-header">
          <span>Готово видео</span>
          <strong>${state.ready_regular_count} / ${state.ready_regular_total}</strong>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${getPreparationProgress(state)}%"></div>
        </div>
      </div>

      ${
        state.can_submit_video
          ? renderVideoForm("sendVideo")
          : `<div class="waiting-banner">Ждём остальных.</div>`
      }
                <div class="progress-panel">
        <div class="progress-header">
          <span>Смена темы</span>
          <strong>${state.topic_reroll_votes_count} / ${state.topic_reroll_votes_needed}</strong>
        </div>
        <div class="progress-bar">
          <div
            class="progress-fill"
            style="width: ${getTopicRerollProgress(state)}%"
          ></div>
        </div>
        ${
          state.can_vote_topic_reroll
            ? `<button id="voteRerollTopicBtn" class="ghost large">Хочу другую тему</button>`
            : `<div class="waiting-banner">Твой голос учтён.</div>`
        }
      </div>
    </div>
  `;
}

function renderPlayingScene(state) {
  const current = state.current_submission;
  const currentName = current ? current.player_name : state.current_player_name || "—";

  const spyLateInsertBlock =
    state.role === "spy" && state.can_submit_video
      ? `
        <div class="late-spy-panel">
          <div class="late-spy-title">Можно вставить своё видео</div>
          <div class="late-spy-subtitle">Ты можешь сделать это в любой момент после первого ролика.</div>
          ${renderVideoForm("lateSpy")}
        </div>
      `
      : "";

  return `
    <div class="card phase-card playback-phase">
      <div class="phase-title">Слушаем ролик</div>

      <div class="playback-focus">
        <div class="now-playing-label">Сейчас играет</div>
        <div class="now-playing-name">${escapeHtml(currentName)}</div>
        <div class="playback-progress">
          Видео ${state.queue_played.length} из ${state.queue_total}
        </div>
      </div>

      ${current ? `<div class="video-title-line">${escapeHtml(current.title || "Без названия")}</div>` : ""}

      <div class="player-stage">
        ${
          current
            ? `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(current.video_id)}?start=${current.start_seconds}&autoplay=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>`
            : `<div class="player-placeholder">Плеер готовится...</div>`
        }
      </div>

      ${spyLateInsertBlock}
    </div>
  `;
}

function renderSpyWindowScene(state) {
  const isSpy = state.role === "spy";

  return `
    <div class="card phase-card">
      <div class="phase-title">Окно шпиона</div>

      ${
        isSpy
          ? `
            <div class="identity-panel identity-spy">
              <div class="identity-label">Ход</div>
              <div class="identity-main danger">Твой выбор</div>
              <div class="identity-subtext">Можешь вставить видео сейчас или пропустить.</div>
            </div>
          `
          : `
            <div class="identity-panel">
              <div class="identity-label">Сейчас</div>
              <div class="identity-main">Ждём решение шпиона</div>
            </div>
          `
      }

      ${
        state.can_submit_video
          ? renderVideoForm("spyWindow")
          : `<div class="waiting-banner">Пока действий от тебя не требуется.</div>`
      }

      ${
        state.can_skip_spy_window
          ? `
            <div class="secondary-action-row">
              <button id="skipSpyWindowBtn" class="ghost large">Пропустить</button>
            </div>
          `
          : ``
      }

      ${
        state.can_continue_spy_window
          ? `
            <div class="secondary-action-row">
              <button id="continueSpyWindowBtn" class="secondary large">
                Продолжить
              </button>
            </div>
          `
          : ``
      }
    </div>
  `;
}

function renderVotingScene(state) {
  const spyLateInsertBlock =
    state.role === "spy" && state.can_submit_video
      ? `
        <div class="late-spy-panel">
          <div class="late-spy-title">Можно вставить своё видео</div>
          <div class="late-spy-subtitle">Даже если ты пропустил окно после первого ролика.</div>
          ${renderVideoForm("lateSpy")}
        </div>
      `
      : "";

  return `
    <div class="card phase-card voting-phase">
      <div class="phase-title">Голосование</div>

      <div class="vote-target-panel">
        <div class="vote-target-label">Цель</div>
        <div class="vote-target-name">${escapeHtml(state.voting_target || "—")}</div>
      </div>

      ${
        state.can_vote
          ? `
            <div class="vote-action-panel">
              <div class="vote-buttons">
                <button id="voteSpyBtn" class="primary large">Шпион</button>
                <button id="voteNotSpyBtn" class="secondary large">Не шпион</button>
                <button id="voteAbstainBtn" class="ghost large">Воздержаться</button>
              </div>
            </div>
          `
          : `<div class="waiting-banner">Ждём остальные голоса.</div>`
      }

      ${spyLateInsertBlock}
    </div>
  `;
}

function renderRevealScene(state) {
  const revealHeadline = getRevealHeadline(state);
  const revealSubline = state.status_text || "Раунд завершён.";

  return `
    <div class="card phase-card reveal-phase">
      <div class="phase-title">${escapeHtml(revealHeadline)}</div>
      <div class="phase-description">${escapeHtml(revealSubline)}</div>

      <div class="reveal-grid">
        ${state.players.map((player) => `
          <div class="reveal-player-card ${player.role === "spy" ? "spy-revealed" : ""}">
            <div class="reveal-player-top">
              <div class="reveal-player-name">${escapeHtml(player.name)}</div>
              <div class="reveal-player-score">${player.score}</div>
            </div>
            <div class="reveal-player-role">
              ${player.role === "spy" ? "Шпион" : "Игрок"}
            </div>
          </div>
        `).join("")}
      </div>

      <div class="primary-action">
        ${
          state.is_host
            ? `<button id="nextRoundBtn" class="primary large">Следующий раунд</button>`
            : `<div class="waiting-banner">Ждём хоста.</div>`
        }
      </div>
    </div>
  `;
}

function renderVideoForm(context) {
  const buttonText =
    context === "spyWindow"
      ? "Отправить видео"
      : context === "lateSpy"
        ? "Вставить видео"
        : "Отправить видео";

  return `
    <div class="video-form-card">
      <label class="field">
        <span>YouTube ссылка</span>
        <input
          id="videoUrlInput"
          type="text"
          placeholder="https://youtu.be/..."
          value="${escapeHtml(draftVideoUrl)}"
        />
      </label>

      <label class="field">
        <span>Таймкод</span>
        <input
          id="timecodeInput"
          type="text"
          placeholder="необязательно"
          value="${escapeHtml(draftTimecode)}"
        />
      </label>

      <button id="submitVideoBtn" class="primary large">${buttonText}</button>
    </div>
  `;
}

function renderPlayersCompact(players, state) {
  return `
    <div class="players-compact-list">
      ${players.map((player) => `
        <div class="player-chip ${getPlayerChipClass(player, state)}">
          <div class="player-chip-main">
            <span class="player-chip-name">${escapeHtml(player.name)}</span>
            ${player.name === state.you ? `<span class="tag">ты</span>` : ""}
            ${player.name === state.host ? `<span class="tag">хост</span>` : ""}
          </div>
          <div class="player-chip-meta">
            <span>${player.score} очк.</span>
            <span>${player.connected ? "online" : "offline"}</span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderPlayersDetailed(players, state) {
  return `
    <div class="players-detailed-list">
      ${players.map((player) => `
        <div class="player-row ${getPlayerRowClass(player, state)}">
          <div class="player-row-left">
            <div class="player-row-name">
              ${escapeHtml(player.name)}
              ${player.name === state.you ? `<span class="tag">ты</span>` : ""}
              ${player.name === state.host ? `<span class="tag">хост</span>` : ""}
            </div>
            <div class="player-row-meta">
              ${player.connected ? "online" : "offline"}
              ${player.suspected ? " · шпион?" : ""}
              ${state.phase === "reveal" && player.role ? ` · ${player.role === "spy" ? "шпион" : "игрок"}` : ""}
            </div>
          </div>
          <div class="player-row-right">
            <div class="player-row-score">${player.score}</div>
            <div class="player-row-meta">очков</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderVoteStatuses(statuses) {
  if (!statuses || !statuses.length) {
    return `<div class="muted">Статусы появятся здесь.</div>`;
  }

  return statuses.map((row) => `
    <div class="vote-status-row">
      <div class="vote-status-name">${escapeHtml(row.name)}</div>
      <div class="vote-status-value">${escapeHtml(row.status)}</div>
    </div>
  `).join("");
}

function captureDraftInputs() {
  const urlInput = document.getElementById("videoUrlInput");
  const timecodeInput = document.getElementById("timecodeInput");

  if (urlInput) {
    draftVideoUrl = urlInput.value;
  }
  if (timecodeInput) {
    draftTimecode = timecodeInput.value;
  }
}

function bindDraftInputs() {
  const urlInput = document.getElementById("videoUrlInput");
  const timecodeInput = document.getElementById("timecodeInput");

  if (urlInput) {
    urlInput.addEventListener("input", (event) => {
      draftVideoUrl = event.target.value;
    });
  }

  if (timecodeInput) {
    timecodeInput.addEventListener("input", (event) => {
      draftTimecode = event.target.value;
    });
  }
}

function bindPhaseActions(state) {
    if (state.is_host) {
    document.getElementById("openSpectatorBtn")?.addEventListener("click", openSpectatorWindow);
  }

  if (state.is_host && state.phase === "preparation") {
    document.getElementById("rerollTopicBtn")?.addEventListener("click", rerollTopic);
  }

  if (state.phase === "lobby" && state.is_host) {
    document.getElementById("startRoundBtn")?.addEventListener("click", startRound);
  }

  if (state.phase === "preparation") {
    if (state.can_submit_video) {
      document.getElementById("submitVideoBtn")?.addEventListener("click", submitVideo);
    }

    if (state.can_vote_topic_reroll) {
      document.getElementById("voteRerollTopicBtn")?.addEventListener("click", voteRerollTopic);
    }
  }

  if (state.phase === "playing" && state.role === "spy" && state.can_submit_video) {
    document.getElementById("submitVideoBtn")?.addEventListener("click", submitVideo);
  }

  if (state.phase === "spy_insert_window") {
    if (state.can_submit_video) {
      document.getElementById("submitVideoBtn")?.addEventListener("click", submitVideo);
    }
    if (state.can_skip_spy_window) {
      document.getElementById("skipSpyWindowBtn")?.addEventListener("click", skipSpyWindow);
    }
    if (state.can_continue_spy_window) {
      document.getElementById("continueSpyWindowBtn")?.addEventListener("click", continueAfterSpyWindow);
    }
  }

  if (state.phase === "voting") {
    if (state.can_vote) {
      document.getElementById("voteSpyBtn")?.addEventListener("click", () => sendVote("spy"));
      document.getElementById("voteNotSpyBtn")?.addEventListener("click", () => sendVote("not_spy"));
      document.getElementById("voteAbstainBtn")?.addEventListener("click", () => sendVote("abstain"));
    }
    if (state.role === "spy" && state.can_submit_video) {
      document.getElementById("submitVideoBtn")?.addEventListener("click", submitVideo);
    }
  }

  if (state.phase === "reveal" && state.is_host) {
    document.getElementById("nextRoundBtn")?.addEventListener("click", nextRound);
  }
}

async function voteRerollTopic() {
  const data = await apiGet(
    `/vote_reroll_topic?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`
  );
  if (data.error) alert(data.error);
}

function getTopicRerollProgress(state) {
  if (!state.topic_reroll_votes_needed) return 0;
  return Math.max(
    0,
    Math.min(100, Math.round((state.topic_reroll_votes_count / state.topic_reroll_votes_needed) * 100))
  );
}

function getVoteProgress(state) {
  if (!state.vote_progress_total) return 0;
  return Math.max(
    0,
    Math.min(100, Math.round((state.vote_progress_count / state.vote_progress_total) * 100))
  );
}

async function startRound() {
  const data = await apiGet(`/start_game?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`);
  if (data.error) alert(data.error);
}

async function nextRound() {
  const data = await apiGet(`/next_round?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`);
  if (data.error) alert(data.error);
}

async function continueAfterSpyWindow() {
  const data = await apiGet(`/continue_after_spy_window?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`);
  if (data.error) alert(data.error);
}

async function skipSpyWindow() {
  const data = await apiGet(`/skip_spy_window?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`);
  if (data.error) alert(data.error);
}

async function submitVideo() {
  const url = document.getElementById("videoUrlInput")?.value.trim() || "";
  const timecode = document.getElementById("timecodeInput")?.value.trim() || "";

  const data = await apiGet(
    `/submit_video?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}&url=${encodeURIComponent(url)}&timecode=${encodeURIComponent(timecode)}`
  );

  if (data.error) {
    alert(data.error);
    return;
  }

  draftVideoUrl = "";
  draftTimecode = "";
}

async function sendVote(value) {
  const target = lastState?.voting_target;
  if (!target) return;

  const data = await apiGet(
    `/vote?room_code=${encodeURIComponent(roomCode)}&voter=${encodeURIComponent(playerName)}&target=${encodeURIComponent(target)}&value=${encodeURIComponent(value)}`
  );
  if (data.error) alert(data.error);
}

function getPreparationProgress(state) {
  if (!state.ready_regular_total) return 0;
  return Math.max(0, Math.min(100, Math.round((state.ready_regular_count / state.ready_regular_total) * 100)));
}

function getPlayerChipClass(player, state) {
  const classes = [];
  if (player.name === state.current_player_name) classes.push("is-current");
  if (player.name === state.you) classes.push("is-you");
  if (!player.connected) classes.push("is-offline");
  return classes.join(" ");
}

function getPlayerRowClass(player, state) {
  const classes = [];
  if (player.name === state.current_player_name) classes.push("is-current");
  if (player.name === state.you) classes.push("is-you");
  if (!player.connected) classes.push("is-offline");
  if (player.suspected) classes.push("is-suspected");
  return classes.join(" ");
}

function getRevealHeadline(state) {
  const spyPlayer = state.players.find((p) => p.role === "spy");
  if (!spyPlayer) return "Раунд завершён";

  if (spyPlayer.suspected) {
    return `Шпион найден — ${spyPlayer.name}`;
  }

  return `Шпион не выявлен — ${spyPlayer.name}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
async function rerollTopic() {
  const data = await apiGet(
    `/reroll_topic?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`
  );
  if (data.error) alert(data.error);
}

function openSpectatorWindow() {
  const url = `/spectator?room_code=${encodeURIComponent(roomCode)}`;
  window.open(
    url,
    "music_spy_spectator",
    "width=1280,height=820,resizable=yes,scrollbars=no"
  );
}
document.getElementById("createRoomBtn").addEventListener("click", createRoom);
document.getElementById("joinRoomBtn").addEventListener("click", joinRoom);