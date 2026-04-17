let roomCode = "";
let playerName = "";
let socket = null;
let lastState = null;

function setMsg(id, text, isError = false) {
  const el = document.getElementById(id);
  el.textContent = text || "";
  el.className = isError ? "danger" : "muted";
}

function setDebug(text) {
  document.getElementById("debugMsg").textContent = text || "";
}

function getWsProtocol() {
  return window.location.protocol === "https:" ? "wss" : "ws";
}

async function createRoom() {
  playerName = document.getElementById("nameInput").value.trim();
  if (!playerName) {
    setMsg("authMsg", "Введите ник.", true);
    return;
  }

  const res = await fetch(`/create_room?name=${encodeURIComponent(playerName)}`);
  const data = await res.json();
  if (data.error) {
    setMsg("authMsg", data.error, true);
    return;
  }

  roomCode = data.room_code;
  document.getElementById("createdRoomWrap").classList.remove("hidden");
  document.getElementById("createdRoomCode").textContent = roomCode;

  const joinRes = await fetch(`/join_room?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`);
  const joinData = await joinRes.json();
  if (joinData.error) {
    setMsg("authMsg", joinData.error, true);
    return;
  }

  afterJoin();
}

async function joinRoom() {
  playerName = document.getElementById("nameInput").value.trim();
  roomCode = document.getElementById("roomCodeInput").value.trim();

  if (!playerName || !roomCode) {
    setMsg("authMsg", "Введите ник и код комнаты.", true);
    return;
  }

  const res = await fetch(`/join_room?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`);
  const data = await res.json();
  if (data.error) {
    setMsg("authMsg", data.error, true);
    return;
  }

  afterJoin();
}

function afterJoin() {
  document.getElementById("authCard").classList.add("hidden");
  document.getElementById("gameUI").classList.remove("hidden");
  document.getElementById("roomCodeLabel").textContent = roomCode;
  connectWs();
}

function connectWs() {
  const wsProtocol = getWsProtocol();
  const wsUrl = `${wsProtocol}://${location.host}/ws/${roomCode}/${encodeURIComponent(playerName)}`;
  setDebug("");

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    socket.send("ping");
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "state") {
      lastState = msg.data;
      renderState(msg.data);
    }
  };

  socket.onerror = () => {
    setDebug("Ошибка WebSocket. Проверь, что сервер запущен и ссылка туннеля активна.");
  };

  socket.onclose = () => {
    setDebug("Соединение потеряно. Пытаюсь переподключиться...");
    setTimeout(connectWs, 1500);
  };
}

function renderState(state) {
  document.getElementById("roomCodeLabel").textContent = state.room_code || roomCode;
  document.getElementById("youLabel").textContent = state.you;
  document.getElementById("hostLabel").textContent = state.host;
  document.getElementById("roundLabel").textContent = state.round_number;
  document.getElementById("phaseLabel").textContent = state.phase;
  document.getElementById("statusText").textContent = state.status_text;

  const startBtn = document.getElementById("startBtn");
  startBtn.style.display = state.is_host ? "inline-block" : "none";

  const roleInfo = document.getElementById("roleInfo");
  if (!state.role) {
    roleInfo.innerHTML = "Пока нет активного раунда.";
  } else if (state.role === "spy") {
    roleInfo.innerHTML = "<span class='danger'>Ты шпион.</span> Тема тебе не показывается.";
  } else {
    roleInfo.innerHTML = `<span class='good'>Ты обычный игрок.</span><br>Тема: <strong>${state.topic || "-"}</strong>`;
  }

  const playersList = document.getElementById("playersList");
  playersList.innerHTML = "";
  state.players.forEach((p) => {
    const div = document.createElement("div");
    div.className = "player";
    const extra = [];
    if (p.connected) extra.push("online");
    if (p.suspected) extra.push("шпион?");
    if (p.role_revealed && p.role) extra.push(`роль: ${p.role}`);
    div.innerHTML = `<strong>${p.name}</strong> — ${p.score} очк.<br><span class="muted">${extra.join(" · ")}</span>`;
    playersList.appendChild(div);
  });

  const submitMsg = document.getElementById("submitMsg");
  if (state.can_submit_video) {
    submitMsg.textContent = state.your_submission_done ? "Видео уже отправлено." : "Сейчас можно отправить видео.";
  } else {
    submitMsg.textContent = state.your_submission_done ? "Видео уже отправлено." : "Сейчас отправка видео недоступна.";
  }

  const playInfo = document.getElementById("playInfo");
  const playerBox = document.getElementById("playerBox");
  playerBox.innerHTML = "";
  if (state.current_submission) {
    const s = state.current_submission;
    playInfo.innerHTML = `Игрок: <strong>${s.player_name}</strong>. Прогресс: ${state.queue_played.length}/${state.queue_total}`;
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube.com/embed/${s.video_id}?start=${s.start_seconds}&autoplay=1`;
    iframe.allow = "autoplay; encrypted-media";
    playerBox.appendChild(iframe);
  } else {
    playInfo.textContent = "Пока ничего не играет.";
  }

  const voteInfo = document.getElementById("voteInfo");
  const voteControls = document.getElementById("voteControls");
  const voteStatusList = document.getElementById("voteStatusList");

  if (state.phase === "voting" && state.voting_target) {
    voteInfo.innerHTML = `Голосование по игроку: <strong>${state.voting_target}</strong>`;
    voteControls.classList.toggle("hidden", !state.can_vote);
    if (!state.can_vote) {
      if (state.you === state.voting_target) {
        voteInfo.innerHTML += "<br><span class='muted'>Тебе автоматически засчитан голос 'не шпион'.</span>";
      } else {
        voteInfo.innerHTML += "<br><span class='muted'>Ты уже проголосовал.</span>";
      }
    }

    voteStatusList.innerHTML = "";
    state.vote_statuses.forEach((item) => {
      const div = document.createElement("div");
      div.className = "player";
      div.innerHTML = `<strong>${item.name}</strong> — <span class="muted">${item.state}</span>`;
      voteStatusList.appendChild(div);
    });
  } else {
    voteControls.classList.add("hidden");
    if (state.vote_counts) {
      voteInfo.innerHTML = `Последний результат: spy=${state.vote_counts.spy}, not_spy=${state.vote_counts.not_spy}, abstain=${state.vote_counts.abstain}`;
    } else {
      voteInfo.textContent = "Сейчас голосования нет.";
    }
    voteStatusList.textContent = "Сейчас голосования нет.";
  }
}

async function startGame() {
  const res = await fetch(`/start_game?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`);
  const data = await res.json();
  if (data.error) alert(data.error);
}

async function nextRound() {
  const res = await fetch(`/next_round?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}`);
  const data = await res.json();
  if (data.error) alert(data.error);
}

async function submitVideo() {
  if (!lastState || !lastState.can_submit_video) {
    alert("Сейчас нельзя отправить видео.");
    return;
  }

  const url = document.getElementById("videoUrlInput").value.trim();
  const timecode = document.getElementById("timecodeInput").value.trim();
  const res = await fetch(`/submit_video?room_code=${encodeURIComponent(roomCode)}&name=${encodeURIComponent(playerName)}&url=${encodeURIComponent(url)}&timecode=${encodeURIComponent(timecode)}`);
  const data = await res.json();
  if (data.error) {
    alert(data.error);
  } else {
    document.getElementById("videoUrlInput").value = "";
    document.getElementById("timecodeInput").value = "";
  }
}

async function sendVote(value) {
  if (!lastState || lastState.phase !== "voting") return;
  const target = lastState.voting_target;
  const res = await fetch(`/vote?room_code=${encodeURIComponent(roomCode)}&voter=${encodeURIComponent(playerName)}&target=${encodeURIComponent(target)}&value=${encodeURIComponent(value)}`);
  const data = await res.json();
  if (data.error) alert(data.error);
}
