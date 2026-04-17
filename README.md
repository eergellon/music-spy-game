# Музыкальный шпион — MVP v2

## Что изменено
- код разделён по файлам: backend, HTML, JS, CSS;
- игрок, чей ход голосуется, не голосует сам за себя;
- ему автоматически засчитывается голос `не шпион`;
- в голосовании видны только статусы `голосует / проголосовал / авто: не шпион`, без раскрытия самих голосов;
- убран общий статус `видео отправлено`, чтобы шпион не палился;
- пути сделаны через `Path(__file__)`, поэтому запуск из папки `app` снова работает.

## Структура
```text
music_spy_game_v2/
  requirements.txt
  README.md
  app/
    main.py
    game_engine.py
    static/
      index.html
      app.js
      styles.css
```

## Установка
Открой PowerShell в папке `music_spy_game_v2` и установи зависимости:

```powershell
python -m pip install -r requirements.txt
```

## Запуск
Перейди в папку `app`:

```powershell
cd app
```

Запусти сервер:

```powershell
uvicorn main:app --reload
```

Локально игра будет доступна по адресу:

```text
http://127.0.0.1:8000
```

## Публичная ссылка без ngrok
Для тестов вместо ngrok лучше использовать Cloudflare Quick Tunnel.

1. Скачай `cloudflared.exe`.
2. Открой PowerShell в папке, где лежит `cloudflared.exe`.
3. Выполни:

```powershell
.\cloudflared.exe tunnel --url http://localhost:8000
```

4. Получишь ссылку вида:

```text
https://random-name.trycloudflare.com
```

Её и отправляй друзьям.

## Важно
- твой ПК должен быть включён;
- окно с `uvicorn` должно быть открыто;
- окно с `cloudflared` тоже должно быть открыто;
- все комнаты и раунды пока хранятся в памяти сервера.
