from __future__ import annotations

import random
import re
from typing import Any, Dict, List, Optional

TOPICS = [
    "дождь",
    "ночь",
    "любовь",
    "дорога",
    "огонь",
    "счастье",
    "грусть",
    "космос",
    "время",
    "детство",
    "море",
    "страх",
    "память",
    "танцы",
    "одиночество",
]

PLAY_DURATION_SECONDS = 10


def generate_room_code(existing: Dict[str, dict]) -> str:
    while True:
        code = str(random.randint(1000, 9999))
        if code not in existing:
            return code


def normalize_name(name: str) -> str:
    return (name or "").strip()[:24]


def extract_video_id(url: str) -> Optional[str]:
    if not url:
        return None
    patterns = [
        r"(?:v=)([A-Za-z0-9_-]{11})",
        r"(?:youtu\.be/)([A-Za-z0-9_-]{11})",
        r"(?:embed/)([A-Za-z0-9_-]{11})",
        r"(?:shorts/)([A-Za-z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def parse_timecode(raw: str) -> int:
    raw = (raw or "").strip().lower()
    if not raw:
        return 0
    if raw.isdigit():
        return max(0, int(raw))

    simple = re.fullmatch(r"(?:(\d+)m)?(?:(\d+)s)?", raw)
    if simple and (simple.group(1) or simple.group(2)):
        minutes = int(simple.group(1) or 0)
        seconds = int(simple.group(2) or 0)
        return minutes * 60 + seconds

    parts = raw.split(":")
    if all(part.isdigit() for part in parts):
        if len(parts) == 2:
            mm, ss = map(int, parts)
            return mm * 60 + ss
        if len(parts) == 3:
            hh, mm, ss = map(int, parts)
            return hh * 3600 + mm * 60 + ss
    return 0


class GameEngine:
    def __init__(self) -> None:
        self.rooms: Dict[str, dict] = {}

    def create_room(self, host_name: str) -> str:
        host_name = normalize_name(host_name)
        if not host_name:
            raise ValueError("Введите ник.")

        code = generate_room_code(self.rooms)
        self.rooms[code] = {
            "code": code,
            "host_name": host_name,
            "players": [],
            "phase": "lobby",
            "round_number": 0,
            "topic": None,
            "spy_name": None,
            "spy_inserted": False,
            "base_order": [],
            "queue_total": 0,
            "played_names": [],
            "next_base_index": 0,
            "current_player_name": None,
            "voting_target": None,
            "current_vote_ballots": {},
            "last_vote_counts": None,
            "deferred_votes": [],
            "suspects": [],
            "play_duration": PLAY_DURATION_SECONDS,
            "status_text": "Комната создана. Ждём игроков.",
            "round_task": None,
        }
        return code

    def get_room(self, room_code: str) -> Optional[dict]:
        return self.rooms.get(room_code)

    def find_player(self, room: dict, name: str) -> Optional[dict]:
        for player in room["players"]:
            if player["name"] == name:
                return player
        return None

    def join_room(self, room_code: str, name: str) -> None:
        room = self.get_room(room_code)
        if not room:
            raise LookupError("Комната не найдена.")

        name = normalize_name(name)
        if not name:
            raise ValueError("Введите ник.")

        existing = self.find_player(room, name)
        if existing:
            existing["connected"] = True
            return

        room["players"].append(
            {
                "name": name,
                "score": 0,
                "role": None,
                "submission": None,
                "ws": None,
                "connected": True,
            }
        )

    def start_round(self, room_code: str, requester_name: str) -> None:
        room = self.get_room(room_code)
        if not room:
            raise LookupError("Комната не найдена.")
        if room["host_name"] != requester_name:
            raise PermissionError("Только хост может начать раунд.")
        if room["phase"] not in {"lobby", "reveal"}:
            raise ValueError("Сейчас нельзя начать новый раунд.")
        if len(room["players"]) < 4:
            raise ValueError("Нужно минимум 4 игрока.")

        room["round_number"] += 1
        room["phase"] = "preparation"
        room["topic"] = random.choice(TOPICS)
        room["status_text"] = "Подготовка: обычные игроки отправляют YouTube-ссылку и таймкод."
        room["current_player_name"] = None
        room["base_order"] = []
        room["queue_total"] = 0
        room["played_names"] = []
        room["next_base_index"] = 0
        room["voting_target"] = None
        room["current_vote_ballots"] = {}
        room["last_vote_counts"] = None
        room["deferred_votes"] = []
        room["suspects"] = []
        room["spy_inserted"] = False

        for player in room["players"]:
            player["submission"] = None
            player["role"] = "player"

        spy = random.choice(room["players"])
        spy["role"] = "spy"
        room["spy_name"] = spy["name"]

    def build_base_order(self, room: dict) -> None:
        normal_players = [p["name"] for p in room["players"] if p["role"] == "player"]
        random.shuffle(normal_players)
        room["base_order"] = normal_players
        room["queue_total"] = len(room["players"])

    def all_regular_submitted(self, room: dict) -> bool:
        for player in room["players"]:
            if player["role"] == "player" and player["submission"] is None:
                return False
        return True

    def submit_video(self, room_code: str, name: str, url: str, timecode: str = "") -> str:
        room = self.get_room(room_code)
        if not room:
            raise LookupError("Комната не найдена.")

        player = self.find_player(room, name)
        if not player:
            raise LookupError("Игрок не найден.")

        if room["phase"] not in {"preparation", "spy_insert_window", "between_turns"}:
            raise ValueError("Сейчас нельзя отправлять видео.")

        if player["submission"] is not None:
            raise ValueError("Ты уже отправил видео.")

        video_id = extract_video_id(url)
        if not video_id:
            raise ValueError("Не удалось распознать YouTube-ссылку.")

        start_seconds = parse_timecode(timecode)
        player["submission"] = {
            "original_url": url,
            "video_id": video_id,
            "start_seconds": start_seconds,
        }

        if player["role"] == "spy":
            room["spy_inserted"] = True
            room["base_order"].insert(room["next_base_index"], player["name"])
            room["phase"] = "between_turns"
            room["status_text"] = "Шпион вставил своё видео и станет следующим."
            return "spy_submitted"

        if room["phase"] == "preparation" and self.all_regular_submitted(room):
            self.build_base_order(room)
            room["phase"] = "playing"
            room["status_text"] = "Раунд начался."
            return "start_playback"

        return "submitted"

    def play_next_turn(self, room: dict) -> str:
        if room["next_base_index"] >= len(room["base_order"]) and room["spy_inserted"]:
            if room["deferred_votes"]:
                target = room["deferred_votes"].pop(0)
                room["phase"] = "voting"
                room["voting_target"] = target
                room["current_vote_ballots"] = self._preseed_ballots(room, target)
                room["last_vote_counts"] = None
                room["status_text"] = f"Повторное голосование по игроку {target}."
                return "voting_started"
            room["phase"] = "reveal"
            room["status_text"] = self._finalize_round(room)
            return "round_revealed"

        if room["next_base_index"] >= len(room["base_order"]) and not room["spy_inserted"]:
            room["phase"] = "reveal"
            room["status_text"] = self._finalize_round(room, spy_failed=True)
            return "round_revealed"

        next_name = room["base_order"][room["next_base_index"]]
        room["next_base_index"] += 1
        room["current_player_name"] = next_name
        room["phase"] = "playing"
        room["status_text"] = f"Сейчас играет: {next_name}"
        room["played_names"].append(next_name)
        return "playing"

    def finish_current_playback(self, room: dict) -> str:
        if room["phase"] != "playing" or not room["current_player_name"]:
            return "noop"

        just_played = room["current_player_name"]
        room["current_player_name"] = None

        if len(room["played_names"]) == 1:
            if not room["spy_inserted"]:
                room["phase"] = "spy_insert_window"
                room["status_text"] = "Окно для шпиона: шпион может отправить своё видео и стать следующим."
                return "spy_insert_window"
            return self.play_next_turn(room)

        room["phase"] = "voting"
        room["voting_target"] = just_played
        room["current_vote_ballots"] = self._preseed_ballots(room, just_played)
        room["last_vote_counts"] = None
        room["status_text"] = f"Голосование по игроку {just_played}."
        return "voting_started"

    def _preseed_ballots(self, room: dict, target_name: str) -> Dict[str, str]:
        ballots: Dict[str, str] = {}
        target_player = self.find_player(room, target_name)
        if target_player and target_player.get("connected"):
            ballots[target_name] = "not_spy"
        return ballots

    def resolve_vote_if_ready(self, room_code: str, voter: str, target: str, value: str) -> str:
        room = self.get_room(room_code)
        if not room:
            raise LookupError("Комната не найдена.")
        if room["phase"] != "voting":
            raise ValueError("Сейчас голосование не идёт.")
        if room["voting_target"] != target:
            raise ValueError("Неверная цель голосования.")
        if value not in {"spy", "not_spy", "abstain"}:
            raise ValueError("Неверный голос.")

        player = self.find_player(room, voter)
        if not player:
            raise LookupError("Игрок не найден.")
        if voter == target:
            raise ValueError("Игрок, чей ход рассматривается, не голосует сам за себя.")

        room["current_vote_ballots"][voter] = value

        connected_player_names = [p["name"] for p in room["players"] if p["connected"]]
        if all(name in room["current_vote_ballots"] for name in connected_player_names):
            self._resolve_vote(room, target)
            room["phase"] = "between_turns"
            if len(room["played_names"]) == 1 and not room["spy_inserted"]:
                room["phase"] = "spy_insert_window"
                room["status_text"] = "Окно для шпиона: шпион может отправить своё видео и стать следующим."
                return "spy_insert_window"
            return self.play_next_turn(room)
        return "vote_recorded"

    def _resolve_vote(self, room: dict, target_name: str) -> None:
        ballots = list(room["current_vote_ballots"].values())
        counts = {"spy": 0, "not_spy": 0, "abstain": 0}
        for ballot in ballots:
            if ballot in counts:
                counts[ballot] += 1

        room["last_vote_counts"] = counts
        max_votes = max(counts.values()) if ballots else 0
        leaders = [key for key, value in counts.items() if value == max_votes]

        if max_votes == 0 or len(leaders) > 1 or leaders[0] == "abstain":
            room["status_text"] = f"Голосование по {target_name} перенесено в конец раунда."
            if target_name not in room["deferred_votes"]:
                room["deferred_votes"].append(target_name)
            return

        result = leaders[0]
        if result == "spy":
            if target_name not in room["suspects"]:
                room["suspects"].append(target_name)
            room["status_text"] = f"Игрок {target_name} помечен как 'шпион?'."
            return

        room["status_text"] = f"Игрок {target_name} не признан шпионом."

    def _finalize_round(self, room: dict, spy_failed: bool = False) -> str:
        spy_name = room["spy_name"]

        if spy_failed:
            spy_player = self.find_player(room, spy_name)
            if spy_player:
                spy_player["score"] -= 2
            return f"Раунд окончен. Шпион {spy_name} не успел отправить видео и получил -2."

        spy_marked = spy_name in room["suspects"]
        spy_insert_pos = None
        all_played = room["played_names"][:]
        if spy_name in all_played:
            spy_insert_pos = all_played.index(spy_name) + 1

        if spy_marked:
            spy_player = self.find_player(room, spy_name)
            if spy_player:
                spy_player["score"] -= 2
            for player in room["players"]:
                if player["name"] != spy_name and player["role"] == "player":
                    player["score"] += 1
            status = f"Шпион найден: {spy_name}. Обычные игроки получают очки."
        else:
            spy_player = self.find_player(room, spy_name)
            if spy_player:
                if spy_insert_pos == 2:
                    spy_player["score"] += 4
                elif spy_insert_pos == 3:
                    spy_player["score"] += 3
                else:
                    spy_player["score"] += 2
            status = f"Шпион не выявлен. Шпион {spy_name} получает очки."

        for suspect_name in room["suspects"]:
            suspect_player = self.find_player(room, suspect_name)
            if suspect_player and suspect_player["role"] != "spy":
                for player in room["players"]:
                    if player["name"] != suspect_name and player["role"] == "player":
                        player["score"] -= 1

        return status

    def player_view(self, room: dict, player_name: str) -> dict:
        player = self.find_player(room, player_name)
        if not player:
            return {"error": "player_not_found"}

        current_name = room.get("current_player_name")
        current_submission = None
        if current_name:
            current_player = self.find_player(room, current_name)
            if current_player and current_player.get("submission"):
                current_submission = {
                    "player_name": current_player["name"],
                    "video_id": current_player["submission"]["video_id"],
                    "start_seconds": current_player["submission"]["start_seconds"],
                    "play_duration": room["play_duration"],
                }

        vote_statuses = []
        if room["phase"] == "voting":
            target_name = room.get("voting_target")
            for other in room["players"]:
                if other["name"] == target_name:
                    state = "авто: не шпион"
                elif other["name"] in room["current_vote_ballots"]:
                    state = "проголосовал"
                else:
                    state = "голосует"
                vote_statuses.append({"name": other["name"], "state": state})

        return {
            "room_code": room["code"],
            "phase": room["phase"],
            "host": room["host_name"],
            "you": player["name"],
            "is_host": player["name"] == room["host_name"],
            "role": player.get("role"),
            "topic": room["topic"] if player.get("role") == "player" and room["phase"] != "lobby" else None,
            "players": [
                {
                    "name": p["name"],
                    "score": p["score"],
                    "connected": p["connected"],
                    "suspected": p["name"] in room["suspects"],
                    "role_revealed": room["phase"] == "reveal",
                    "role": p["role"] if room["phase"] == "reveal" else None,
                }
                for p in room["players"]
            ],
            "round_number": room["round_number"],
            "status_text": room["status_text"],
            "current_player_name": current_name,
            "current_submission": current_submission,
            "queue_played": room["played_names"],
            "queue_total": room["queue_total"],
            "voting_target": room.get("voting_target"),
            "vote_counts": room.get("last_vote_counts"),
            "vote_statuses": vote_statuses,
            "deferred_queue": room.get("deferred_votes", []),
            "can_submit_video": room["phase"] in {"preparation", "spy_insert_window", "between_turns"} and player.get("submission") is None,
            "can_vote": room["phase"] == "voting" and player["name"] != room.get("voting_target") and player["name"] not in room["current_vote_ballots"],
            "your_submission_done": player.get("submission") is not None,
        }
