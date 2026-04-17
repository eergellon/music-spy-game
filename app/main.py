from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse

from game_engine import GameEngine

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="Музыкальный шпион")
engine = GameEngine()


async def send_json_safe(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_text(json.dumps(payload, ensure_ascii=False))
    except Exception:
        pass


async def broadcast_state(room_code: str) -> None:
    room = engine.get_room(room_code)
    if not room:
        return

    for player in room["players"]:
        if player["ws"] is not None:
            state = engine.player_view(room, player["name"])
            await send_json_safe(player["ws"], {"type": "state", "data": state})


async def ensure_playback_timer(room_code: str) -> None:
    room = engine.get_room(room_code)
    if not room:
        return
    if room["phase"] != "playing" or not room["current_player_name"]:
        return
    if room.get("round_task") is None or room["round_task"].done():
        room["round_task"] = asyncio.create_task(handle_playback_finish(room_code))


async def handle_playback_finish(room_code: str) -> None:
    room = engine.get_room(room_code)
    if not room:
        return

    # Небольшой буфер, потому что iframe YouTube стартует не мгновенно.
    await asyncio.sleep(room["play_duration"] + 2)

    room = engine.get_room(room_code)
    if not room:
        return

    phase_after = engine.finish_current_playback(room)
    await broadcast_state(room_code)

    if phase_after == "playing":
        await ensure_playback_timer(room_code)


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/static/app.js")
async def static_app_js():
    return FileResponse(STATIC_DIR / "app.js", media_type="application/javascript")


@app.get("/static/styles.css")
async def static_styles_css():
    return FileResponse(STATIC_DIR / "styles.css", media_type="text/css")


@app.get("/create_room")
async def create_room(name: str):
    try:
        return {"room_code": engine.create_room(name)}
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


@app.get("/join_room")
async def join_room(room_code: str, name: str):
    try:
        engine.join_room(room_code, name)
        await broadcast_state(room_code)
        return {"success": True}
    except LookupError as exc:
        return JSONResponse({"error": str(exc)}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


@app.get("/start_game")
async def start_game(room_code: str, name: str):
    try:
        engine.start_round(room_code, name)
        room = engine.get_room(room_code)
        await broadcast_state(room_code)
        if room and room["phase"] == "playing":
            await ensure_playback_timer(room_code)
        return {"success": True}
    except LookupError as exc:
        return JSONResponse({"error": str(exc)}, status_code=404)
    except PermissionError as exc:
        return JSONResponse({"error": str(exc)}, status_code=403)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


@app.get("/next_round")
async def next_round(room_code: str, name: str):
    try:
        engine.start_round(room_code, name)
        room = engine.get_room(room_code)
        await broadcast_state(room_code)
        if room and room["phase"] == "playing":
            await ensure_playback_timer(room_code)
        return {"success": True}
    except LookupError as exc:
        return JSONResponse({"error": str(exc)}, status_code=404)
    except PermissionError as exc:
        return JSONResponse({"error": str(exc)}, status_code=403)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


@app.get("/submit_video")
async def submit_video(room_code: str, name: str, url: str, timecode: str = ""):
    try:
        phase_after = engine.submit_video(room_code, name, url, timecode)

        if phase_after != "silent_waiting":
            await broadcast_state(room_code)

        if phase_after == "playing":
            await ensure_playback_timer(room_code)

        return {"success": True}
    except LookupError as exc:
        return JSONResponse({"error": str(exc)}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


@app.get("/vote")
async def vote(room_code: str, voter: str, target: str, value: str):
    try:
        phase_after = engine.submit_vote(room_code, voter, target, value)
        await broadcast_state(room_code)
        if phase_after == "playing":
            await ensure_playback_timer(room_code)
        return {"success": True}
    except LookupError as exc:
        return JSONResponse({"error": str(exc)}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


@app.get("/continue_after_spy_window")
async def continue_after_spy_window(room_code: str, name: str):
    try:
        phase_after = engine.continue_after_spy_window(room_code, name)
        await broadcast_state(room_code)
        if phase_after == "playing":
            await ensure_playback_timer(room_code)
        return {"success": True}
    except LookupError as exc:
        return JSONResponse({"error": str(exc)}, status_code=404)
    except PermissionError as exc:
        return JSONResponse({"error": str(exc)}, status_code=403)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


@app.get("/skip_spy_window")
async def skip_spy_window(room_code: str, name: str):
    try:
        engine.skip_spy_window(room_code, name)
        await broadcast_state(room_code)
        return {"success": True}
    except LookupError as exc:
        return JSONResponse({"error": str(exc)}, status_code=404)
    except PermissionError as exc:
        return JSONResponse({"error": str(exc)}, status_code=403)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


@app.websocket("/ws/{room_code}/{player_name}")
async def websocket_endpoint(websocket: WebSocket, room_code: str, player_name: str):
    await websocket.accept()

    room = engine.get_room(room_code)
    if not room:
        await websocket.close()
        return

    player = engine.find_player(room, player_name)
    if not player:
        await websocket.close()
        return

    player["ws"] = websocket
    player["connected"] = True
    await broadcast_state(room_code)

    try:
        while True:
            await websocket.receive_text()
            room = engine.get_room(room_code)
            if not room:
                await websocket.close()
                return
            state = engine.player_view(room, player_name)
            await send_json_safe(websocket, {"type": "state", "data": state})
    except WebSocketDisconnect:
        room = engine.get_room(room_code)
        if not room:
            return
        player = engine.find_player(room, player_name)
        if player:
            player["ws"] = None
            player["connected"] = False
        await broadcast_state(room_code)