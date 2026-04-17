let roomCode = "";
let playerName = "";
let socket = null;
let lastState = null;

const authScreen = document.getElementById("authScreen");
const gameScreen = document.getElementById("gameScreen");
const authMessage = document.getElementById("authMessage");
const createdRoomBox = document.getElementById("createdRoomBox");
const createdRoomCode = document.getElementById("createdRoomCode");
const roomCodeLabel = document.getElementById("roomCodeLabel");
const youLabel = document.getElementById("youLabel");
const roundLabel = document.getElementById("roundLabel");
const hostLabel = document.getElementById("hostLabel");
const phaseTitle = document.getElementById("phaseTitle");
const statusText = document.getElementById("statusText");
const phasePanel = document.getElementById("phasePanel");
const playersList = document.getElementById("playersList");
const lastVoteResult = document.getElementById("lastVoteResult");

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

  const joinData = await apiGet(`/join_room?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`);
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

  const data = await apiGet(`/join_room?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`);
  if (data.error) {
    setAuthMessage(data.error);
    return;
  }

  afterJoin();
}

function afterJoin() {
  authScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  roomCodeLabel.textContent = roomCode;
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
  roomCodeLabel.textContent = state.room_code;
  youLabel.textContent = state.you;
  roundLabel.textContent = state.round_number;
  hostLabel.textContent = state.host;
  phaseTitle.textContent = state.phase_title;
  statusText.textContent = state.status_text;
  lastVoteResult.textContent = state.last_vote_result_text || "Пока нет голосований.";

  renderPlayers(state.players);
  renderPhasePanel(state);
}

function renderPlayers(players) {
  playersList.innerHTML = "";
  players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "player-row";
    const left = document.createElement("div");
    left.innerHTML = `<div class="player-name">${escapeHtml(player.name)}</div><div class="player-meta">${player.connected ? "online" : "offline"}${player.suspected ? " · шпион?" : ""}</div>`;
    const right = document.createElement("div");
    right.innerHTML = `<div class="player-name">${player.score}</div><div class="player-meta">очков</div>`;
    row.append(left, right);
    playersList.appendChild(row);
  });
}

function renderPhasePanel(state) {
  switch (state.phase) {
    case "lobby":
      phasePanel.innerHTML = renderLobby(state);
      bindLobbyActions(state);
      break;
    case "preparation":
      phasePanel.innerHTML = renderPreparation(state);
      bindPreparationActions(state);
      break;
    case "playing":
      phasePanel.innerHTML = renderPlaying(state);
      break;
    case "spy_insert_window":
      phasePanel.innerHTML = renderSpyInsertWindow(state);
      bindSpyWindowActions(state);
      break;
    case "voting":
      phasePanel.innerHTML = renderVoting(state);
      bindVotingActions(state);
      break;
    case "reveal":
      phasePanel.innerHTML = renderReveal(state);
      bindRevealActions(state);
      break;
    default:
      phasePanel.innerHTML = `<div class="phase-big-title">Неизвестная фаза</div>`;
  }
}

function renderLobby(state) {
  return `
    <div class="phase-big-title">Лобби</div>
    <div class="phase-subtitle">Соберите игроков и запускайте раунд, когда будете готовы.</div>
    <div class="info-box">
      <div class="counter">Игроков в комнате: <strong>${state.players.length}</strong></div>
      <div class="muted">Сейчас игру можно запустить с любым количеством игроков.</div>
    </div>
    <div class="actions">
      ${state.is_host ? `<button id="startRoundBtn" class="primary">Начать раунд</button>` : `<div class="center-note">Только хост может начать раунд.</div>`}
    </div>
  `;
}

function renderPreparation(state) {
  const roleBlock = state.role === "spy"
    ? `<div class="role-box"><strong class="danger">Ты шпион</strong><div class="muted">Тема скрыта. На этом этапе ты просто ждёшь, пока остальные подготовят видео.</div></div>`
    : `<div class="role-box"><strong class="good">Ты обычный игрок</strong><div class="muted">Тема раунда:</div><div class="phase-big-title" style="font-size:24px; margin-top:8px;">${escapeHtml(state.topic || "-")}</div></div>`;

  const submitBlock = state.can_submit_video ? `
    <div class="video-box">
      <label class="field">
        <span>YouTube ссылка</span>
        <input id="videoUrlInput" type="text" placeholder="https://www.youtube.com/watch?v=..." />
      </label>
      <label class="field">
        <span>Таймкод</span>
        <input id="timecodeInput" type="text" placeholder="83 или 1:23 или 1m23s" />
      </label>
      <button id="submitVideoBtn" class="primary">Отправить видео</button>
    </div>
  ` : `
    <div class="info-box">
      <div class="muted">Сейчас просто ждём готовности обычных игроков. Статусы по конкретным людям не показываются, чтобы не палить шпиона.</div>
    </div>
  `;

  return `
    <div class="phase-big-title">Подготовка</div>
    <div class="phase-subtitle">На этом этапе таймера нет. Когда все обычные игроки отправят видео, игра начнётся автоматически.</div>
    ${roleBlock}
    <div class="counter">Подготовлено видео: <strong>${state.ready_regular_count}</strong> / <strong>${state.ready_regular_total}</strong></div>
    ${submitBlock}
  `;
}

function renderPlaying(state) {
  const current = state.current_submission;
  return `
    <div class="phase-big-title">Слушаем ролик</div>
    <div class="phase-subtitle">Сейчас вся комната просто слушает отрывок. После него игра сама переведёт вас дальше.</div>
    <div class="info-box">
      <div><strong>Сейчас играет:</strong> ${escapeHtml(current ? current.player_name : state.current_player_name || "—")}</div>
      <div class="muted">Прогресс очереди: ${state.queue_played.length} / ${state.queue_total}</div>
    </div>
    ${current ? `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(current.video_id)}?start=${current.start_seconds}&autoplay=1" allow="autoplay; encrypted-media"></iframe>` : `<div class="center-note">Плеер готовится...</div>`}
  `;
}

function renderSpyInsertWindow(state) {
  const spyAction = state.can_submit_video ? `
    <div class="video-box">
      <div class="muted" style="margin-bottom:12px;">Ты шпион. Можешь вставить своё видео прямо сейчас и стать следующим.</div>
      <label class="field">
        <span>YouTube ссылка</span>
        <input id="videoUrlInput" type="text" placeholder="https://www.youtube.com/watch?v=..." />
      </label>
      <label class="field">
        <span>Таймкод</span>
        <input id="timecodeInput" type="text" placeholder="83 или 1:23 или 1m23s" />
      </label>
      <button id="submitVideoBtn" class="primary">Отправить видео</button>
    </div>
  ` : `<div class="info-box"><div class="muted">Сейчас либо ждём, пока шпион решит вставиться, либо хост продолжит игру без него.</div></div>`;

  return `
    <div class="phase-big-title">Окно шпиона</div>
    <div class="phase-subtitle">Первый ролик уже сыграл. Теперь шпион может вставить своё видео следующим ходом.</div>
    ${spyAction}
    ${state.can_continue_spy_window ? `<button id="continueSpyWindowBtn" class="secondary">Продолжить без ожидания шпиона</button>` : ``}
  `;
}

function renderVoting(state) {
  const rows = state.vote_statuses.map((row) => `
    <div class="vote-row">
      <div>${escapeHtml(row.name)}</div>
      <div class="muted">${escapeHtml(row.status)}</div>
    </div>
  `).join("");

  return `
    <div class="phase-big-title">Голосование</div>
    <div class="phase-subtitle">Оцениваем только текущего игрока. Сам он за себя не голосует: ему автоматически ставится «не шпион».</div>
    <div class="info-box">
      <div><strong>Цель голосования:</strong> ${escapeHtml(state.voting_target || "—")}</div>
    </div>
    <div class="vote-status-box">
      <h3>Статусы голосов</h3>
      ${rows}
    </div>
    ${state.can_vote ? `
      <div class="vote-buttons">
        <button id="voteSpyBtn" class="primary">Шпион</button>
        <button id="voteNotSpyBtn" class="secondary">Не шпион</button>
        <button id="voteAbstainBtn" class="ghost">Воздержаться</button>
      </div>
    ` : `<div class="center-note">Твой голос уже учтён или ты не голосуешь в этом раунде.</div>`}
  `;
}

function renderReveal(state) {
  const roles = state.players.map((player) => `
    <div class="player-row">
      <div>
        <div class="player-name">${escapeHtml(player.name)}</div>
        <div class="player-meta">роль: ${escapeHtml(player.role || "—")}</div>
      </div>
      <div>
        <div class="player-name">${player.score}</div>
        <div class="player-meta">очков</div>
      </div>
    </div>
  `).join("");

  return `
    <div class="phase-big-title">Раунд завершён</div>
    <div class="phase-subtitle">Роли раскрыты. Посмотри результат и запускай следующий раунд.</div>
    <div class="reveal-box">
      ${roles}
    </div>
    ${state.is_host ? `<button id="nextRoundBtn" class="primary">Следующий раунд</button>` : `<div class="center-note">Следующий раунд запускает хост.</div>`}
  `;
}

function bindLobbyActions(state) {
  if (state.is_host) {
    document.getElementById("startRoundBtn")?.addEventListener("click", async () => {
      const data = await apiGet(`/start_game?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`);
      if (data.error) alert(data.error);
    });
  }
}

function bindPreparationActions(state) {
  if (!state.can_submit_video) return;
  document.getElementById("submitVideoBtn")?.addEventListener("click", submitVideo);
}

function bindSpyWindowActions(state) {
  if (state.can_submit_video) {
    document.getElementById("submitVideoBtn")?.addEventListener("click", submitVideo);
  }
  if (state.can_continue_spy_window) {
    document.getElementById("continueSpyWindowBtn")?.addEventListener("click", async () => {
      const data = await apiGet(`/continue_after_spy_window?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`);
      if (data.error) alert(data.error);
    });
  }
}

function bindVotingActions(state) {
  if (!state.can_vote) return;
  document.getElementById("voteSpyBtn")?.addEventListener("click", () => sendVote("spy"));
  document.getElementById("voteNotSpyBtn")?.addEventListener("click", () => sendVote("not_spy"));
  document.getElementById("voteAbstainBtn")?.addEventListener("click", () => sendVote("abstain"));
}

function bindRevealActions(state) {
  if (!state.is_host) return;
  document.getElementById("nextRoundBtn")?.addEventListener("click", async () => {
    const data = await apiGet(`/next_round?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`);
    if (data.error) alert(data.error);
  });
}

async function submitVideo() {
  const url = document.getElementById("videoUrlInput")?.value.trim() || "";
  const timecode = document.getElementById("timecodeInput")?.value.trim() || "";
  const data = await apiGet(`/submit_video?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}&url=${encodeURIComponent(url)}&timecode=${encodeURIComponent(timecode)}`);
  if (data.error) alert(data.error);
}

async function sendVote(value) {
  const target = lastState?.voting_target;
  if (!target) return;
  const data = await apiGet(`/vote?room_code=${encodeURIComponent(roomCode)}&voter=${encodeURIComponent(playerName)}&target=${encodeURIComponent(target)}&value=${encodeURIComponent(value)}`);
  if (data.error) alert(data.error);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.getElementById("createRoomBtn").addEventListener("click", createRoom);
document.getElementById("joinRoomBtn").addEventListener("click", joinRoom);
