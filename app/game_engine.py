from __future__ import annotations

import random
import re
from typing import Dict, List, Optional


class GameEngine:
    def __init__(self) -> None:
        self.rooms: Dict[str, dict] = {}
        self.topics = [
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
            "ветер",
            "город",
            "лето",
        ]

    def get_room(self, room_code: str) -> Optional[dict]:
        return self.rooms.get(room_code)

    def generate_room_code(self) -> str:
        while True:
            code = str(random.randint(1000, 9999))
            if code not in self.rooms:
                return code

    def normalize_name(self, name: str) -> str:
        return (name or "").strip()[:24]

    def find_player(self, room: dict, name: str) -> Optional[dict]:
        for player in room["players"]:
            if player["name"] == name:
                return player
        return None

    def create_room(self, name: str) -> str:
        name = self.normalize_name(name)
        if not name:
            raise ValueError("Введите ник.")

        code = self.generate_room_code()
        self.rooms[code] = {
            "code": code,
            "host_name": name,
            "players": [],
            "phase": "lobby",
            "round_number": 0,
            "topic": None,
            "spy_name": None,
            "spy_inserted": False,
            "base_order": [],
            "played_names": [],
            "next_base_index": 0,
            "queue_total": 0,
            "current_player_name": None,
            "voting_target": None,
            "current_vote_ballots": {},
            "last_vote_counts": None,
            "deferred_votes": [],
            "suspects": [],
            "play_duration": 10,
            "status_text": "Комната создана. Ждём игроков.",
            "round_task": None,
        }
        return code

    def join_room(self, room_code: str, name: str) -> None:
        room = self.get_room(room_code)
        if not room:
            raise LookupError("Комната не найдена.")

        name = self.normalize_name(name)
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

    def parse_timecode(self, raw: str) -> int:
        raw = (raw or "").strip().lower()
        if not raw:
            return 0

        if raw.isdigit():
            return max(0, int(raw))

        match = re.fullmatch(r"(?:(\d+)m)?(?:(\d+)s)?", raw)
        if match and (match.group(1) or match.group(2)):
            minutes = int(match.group(1) or 0)
            seconds = int(match.group(2) or 0)
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

    def extract_video_id(self, url: str) -> Optional[str]:
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

    def start_round(self, room_code: str, requester: str) -> None:
        room = self.get_room(room_code)
        if not room:
            raise LookupError("Комната не найдена.")
        if room["host_name"] != requester:
            raise PermissionError("Только хост может начать раунд.")
        if room["phase"] not in {"lobby", "reveal"}:
            raise ValueError("Сейчас нельзя начать новый раунд.")

        room["round_number"] += 1
        room["topic"] = random.choice(self.topics)
        room["phase"] = "preparation"
        room["status_text"] = "Этап подготовки. Обычные игроки отправляют ссылку и таймкод. Таймера нет."
        room["spy_name"] = None
        room["spy_inserted"] = False
        room["base_order"] = []
        room["played_names"] = []
        room["next_base_index"] = 0
        room["queue_total"] = len(room["players"])
        room["current_player_name"] = None
        room["voting_target"] = None
        room["current_vote_ballots"] = {}
        room["last_vote_counts"] = None
        room["deferred_votes"] = []
        room["suspects"] = []
        room["round_task"] = None

        for player in room["players"]:
            player["role"] = "player"
            player["submission"] = None

        if room["players"]:
            spy = random.choice(room["players"])
            spy["role"] = "spy"
            room["spy_name"] = spy["name"]

        if self.regular_player_count(room) == 0:
            room["phase"] = "reveal"
            room["status_text"] = "В раунде нет обычных игроков. Шпион автоматически проиграл."
            spy = self.find_player(room, room["spy_name"])
            if spy:
                spy["score"] -= 2

    def regular_player_count(self, room: dict) -> int:
        return sum(1 for p in room["players"] if p["role"] == "player")

    def regular_submitted_count(self, room: dict) -> int:
        return sum(1 for p in room["players"] if p["role"] == "player" and p["submission"] is not None)

    def player_view(self, room: dict, player_name: str) -> dict:
        player = self.find_player(room, player_name)
        if not player:
            return {"error": "player_not_found"}

        current_submission = None
        if room["current_player_name"]:
            current_player = self.find_player(room, room["current_player_name"])
            if current_player and current_player["submission"]:
                current_submission = {
                    "player_name": current_player["name"],
                    "video_id": current_player["submission"]["video_id"],
                    "start_seconds": current_player["submission"]["start_seconds"],
                    "play_duration": room["play_duration"],
                }

        topic = room["topic"] if player["role"] == "player" and room["phase"] != "lobby" else None
        vote_statuses = self.build_vote_statuses(room)

        can_submit_video = False
        if player["submission"] is None:
            if player["role"] == "player" and room["phase"] == "preparation":
                can_submit_video = True
            elif player["role"] == "spy" and room["phase"] in {"spy_insert_window", "playing", "voting"} and len(room["played_names"]) >= 1:
                can_submit_video = True

        can_vote = (
            room["phase"] == "voting"
            and room["voting_target"] is not None
            and room["voting_target"] != player_name
            and player_name not in room["current_vote_ballots"]
        )

        phase_title_map = {
            "lobby": "Лобби",
            "preparation": "Подготовка",
            "playing": "Прослушивание видео",
            "spy_insert_window": "Окно шпиона",
            "voting": "Голосование",
            "reveal": "Раскрытие ролей",
        }

        players_public = []
        for p in room["players"]:
            players_public.append(
                {
                    "name": p["name"],
                    "score": p["score"],
                    "connected": p["connected"],
                    "suspected": p["name"] in room["suspects"],
                    "role": p["role"] if room["phase"] == "reveal" else None,
                }
            )

        return {
            "room_code": room["code"],
            "phase": room["phase"],
            "phase_title": phase_title_map.get(room["phase"], room["phase"]),
            "status_text": room["status_text"],
            "round_number": room["round_number"],
            "host": room["host_name"],
            "you": player_name,
            "is_host": room["host_name"] == player_name,
            "role": player["role"],
            "topic": topic,
            "players": players_public,
            "current_player_name": room["current_player_name"],
            "current_submission": current_submission,
            "queue_played": room["played_names"],
            "queue_total": room["queue_total"],
            "voting_target": room["voting_target"],
            "vote_counts": room["last_vote_counts"],
            "vote_statuses": vote_statuses,
            "ready_regular_count": self.regular_submitted_count(room),
            "ready_regular_total": self.regular_player_count(room),
            "spy_has_submitted": bool(self.find_player(room, room["spy_name"])["submission"]) if room["spy_name"] and self.find_player(room, room["spy_name"]) else False,
            "can_submit_video": can_submit_video,
            "can_vote": can_vote,
            "can_continue_spy_window": room["phase"] == "spy_insert_window" and room["host_name"] == player_name,
            "last_vote_result_text": self.build_last_vote_result_text(room),
        }

    def build_last_vote_result_text(self, room: dict) -> Optional[str]:
        counts = room.get("last_vote_counts")
        if not counts:
            return None
        return f"Итоги последнего голосования: шпион={counts['spy']}, не шпион={counts['not_spy']}, воздержался={counts['abstain']}"

    def build_vote_statuses(self, room: dict) -> List[dict]:
        if room["phase"] != "voting" or not room["voting_target"]:
            return []

        target = room["voting_target"]
        result = []
        for player in room["players"]:
            if player["name"] == target:
                status = "авто: не шпион"
            elif player["name"] in room["current_vote_ballots"]:
                status = "проголосовал"
            else:
                status = "ждём голос"
            result.append({"name": player["name"], "status": status})
        return result

    def build_base_order(self, room: dict) -> None:
        order = [player["name"] for player in room["players"] if player["role"] == "player"]
        random.shuffle(order)
        room["base_order"] = order
        room["queue_total"] = len(order) + (1 if room["spy_name"] else 0)

    def play_next_turn(self, room: dict) -> Optional[str]:
        if room["next_base_index"] < len(room["base_order"]):
            next_name = room["base_order"][room["next_base_index"]]
            room["next_base_index"] += 1
            room["current_player_name"] = next_name
            room["phase"] = "playing"
            room["played_names"].append(next_name)
            room["status_text"] = f"Сейчас играет: {next_name}. Слушаем отрывок."
            return "playing"

        if room["deferred_votes"]:
            target = room["deferred_votes"].pop(0)
            self.begin_vote(room, target)
            return "voting"

        if room["spy_inserted"]:
            self.finalize_round(room)
            return "reveal"

        self.finalize_round(room, spy_failed=True)
        return "reveal"

    def submit_video(self, room_code: str, name: str, url: str, timecode: str) -> str:
        room = self.get_room(room_code)
        if not room:
            raise LookupError("Комната не найдена.")

        player = self.find_player(room, name)
        if not player:
            raise LookupError("Игрок не найден.")
        if player["submission"] is not None:
            raise ValueError("Ты уже отправил видео.")

        video_id = self.extract_video_id(url)
        if not video_id:
            raise ValueError("Не удалось распознать YouTube-ссылку.")

        submission = {
            "original_url": url,
            "video_id": video_id,
            "start_seconds": self.parse_timecode(timecode),
        }

        if player["role"] == "player":
            if room["phase"] != "preparation":
                raise ValueError("Обычный игрок может отправить видео только на этапе подготовки.")
            player["submission"] = submission

            if self.regular_submitted_count(room) >= self.regular_player_count(room):
                self.build_base_order(room)
                return self.play_next_turn(room) or "noop"

            room["status_text"] = "Ждём, пока остальные обычные игроки подготовят видео."
            return "waiting"

        if room["phase"] not in {"spy_insert_window", "playing", "voting"} or len(room["played_names"]) < 1:
            raise ValueError("Шпион пока не может отправить видео.")

        player["submission"] = submission
        if not room["spy_inserted"]:
            room["spy_inserted"] = True
            room["base_order"].insert(room["next_base_index"], player["name"])

        if room["phase"] == "spy_insert_window":
            room["status_text"] = "Шпион отправил видео и будет следующим."
            return self.play_next_turn(room) or "noop"

        room["status_text"] = "Шпион отправил видео и встанет следующим после завершения текущего шага."
        return "waiting"

    def continue_after_spy_window(self, room_code: str, requester: str) -> str:
        room = self.get_room(room_code)
        if not room:
            raise LookupError("Комната не найдена.")
        if room["host_name"] != requester:
            raise PermissionError("Только хост может продолжить игру.")
        if room["phase"] != "spy_insert_window":
            raise ValueError("Сейчас нельзя пропустить окно шпиона.")

        room["status_text"] = "Хост продолжил игру без вставки шпиона в это окно."
        return self.play_next_turn(room) or "noop"

    def finish_current_playback(self, room: dict) -> str:
        current_name = room["current_player_name"]
        if not current_name or room["phase"] != "playing":
            return room["phase"]

        room["current_player_name"] = None

        if len(room["played_names"]) == 1 and not room["spy_inserted"]:
            room["phase"] = "spy_insert_window"
            room["status_text"] = "Первый ролик закончился. Шпион может отправить своё видео, либо хост может продолжить игру."
            return "spy_insert_window"

        self.begin_vote(room, current_name)
        return "voting"

    def begin_vote(self, room: dict, target_name: str) -> None:
        room["phase"] = "voting"
        room["voting_target"] = target_name
        room["current_vote_ballots"] = {target_name: "not_spy"}
        room["last_vote_counts"] = None
        room["status_text"] = f"Голосование по игроку {target_name}. Сам игрок автоматически получает голос 'не шпион'."

    def submit_vote(self, room_code: str, voter: str, target: str, value: str) -> str:
        room = self.get_room(room_code)
        if not room:
            raise LookupError("Комната не найдена.")
        if room["phase"] != "voting":
            raise ValueError("Сейчас голосование не идёт.")
        if room["voting_target"] != target:
            raise ValueError("Неверная цель голосования.")
        if value not in {"spy", "not_spy", "abstain"}:
            raise ValueError("Неверный голос.")
        if voter == target:
            raise ValueError("Текущий игрок не голосует сам за себя.")

        player = self.find_player(room, voter)
        if not player:
            raise LookupError("Игрок не найден.")

        room["current_vote_ballots"][voter] = value

        connected_names = [p["name"] for p in room["players"] if p["connected"]]
        expected_votes = len(connected_names)
        if room["voting_target"] not in connected_names:
            expected_votes += 1

        if len(room["current_vote_ballots"]) >= expected_votes:
            return self.resolve_current_vote(room)

        room["status_text"] = f"Голосование по игроку {target}. Ждём остальных голосов."
        return "waiting"

    def resolve_current_vote(self, room: dict) -> str:
        counts = {"spy": 0, "not_spy": 0, "abstain": 0}
        for vote_value in room["current_vote_ballots"].values():
            if vote_value in counts:
                counts[vote_value] += 1
        room["last_vote_counts"] = counts

        max_votes = max(counts.values()) if counts else 0
        leaders = [key for key, value in counts.items() if value == max_votes]
        target = room["voting_target"]

        if max_votes == 0 or len(leaders) > 1 or leaders[0] == "abstain":
            if target not in room["deferred_votes"]:
                room["deferred_votes"].append(target)
            room["status_text"] = f"Голосование по {target} перенесено в конец раунда."
        elif leaders[0] == "spy":
            if target not in room["suspects"]:
                room["suspects"].append(target)
            room["status_text"] = f"Игрок {target} помечен как 'шпион?'."
        else:
            room["status_text"] = f"Игрок {target} не признан шпионом."

        room["voting_target"] = None
        room["current_vote_ballots"] = {}

        return self.play_next_turn(room) or "noop"

    def finalize_round(self, room: dict, spy_failed: bool = False) -> None:
        room["phase"] = "reveal"
        spy_name = room["spy_name"]
        spy_player = self.find_player(room, spy_name) if spy_name else None

        if spy_failed:
            if spy_player:
                spy_player["score"] -= 2
            room["status_text"] = f"Раунд окончен. Шпион {spy_name} не успел показать видео и получает -2."
            return

        spy_marked = spy_name in room["suspects"] if spy_name else False
        spy_insert_pos = None
        if spy_name in room["played_names"]:
            spy_insert_pos = room["played_names"].index(spy_name) + 1

        if spy_marked:
            if spy_player:
                spy_player["score"] -= 2
            for player in room["players"]:
                if player["role"] == "player":
                    player["score"] += 1
            room["status_text"] = f"Шпион найден: {spy_name}. Обычные игроки получают очки."
        else:
            if spy_player:
                if spy_insert_pos == 2:
                    spy_player["score"] += 4
                elif spy_insert_pos == 3:
                    spy_player["score"] += 3
                else:
                    spy_player["score"] += 2
            room["status_text"] = f"Шпион не выявлен. Шпион {spy_name} получает очки."

        for suspect_name in room["suspects"]:
            suspect_player = self.find_player(room, suspect_name)
            if suspect_player and suspect_player["role"] != "spy":
                for player in room["players"]:
                    if player["role"] == "player" and player["name"] != suspect_name:
                        player["score"] -= 1
