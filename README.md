# Premiere Assistant

ИИ-ассистент внутри Adobe Premiere Pro: панель-чат + локальный помощник. Модель на выбор: OpenRouter (бесплатные модели), Ollama (локально), Gemini (бесплатный тариф) или Claude (платно).
Подробное описание проекта и план — в [CLAUDE.md](CLAUDE.md).

```
packages/core            общие типы: контракт инструментов, протокол панель ↔ помощник
packages/helper          помощник (Node): WebSocket-сервер, агентный цикл с Claude, инструменты
packages/panel-premiere  UXP-панель (React): чат, подтверждения, лог задач, host-инструменты
knowledge/               база знаний (заметки, рецепты)
```

## Самый простой вариант (без помощника)

1. `npm install`, затем `npm run build:panel`.
2. UXP Developer Tool → **Add Plugin** → `packages/panel-premiere/dist/manifest.json` → **⋯ → Package** — получится файл `.ccx`.
3. Дважды кликните по `.ccx` — Creative Cloud установит плагин в Premiere насовсем (UDT и режим разработчика больше не нужны).
4. Откройте панель (меню **Window**), на экране приветствия вставьте бесплатный ключ OpenRouter (openrouter.ai → Keys) — один раз.

Всё: ИИ работает прямо из панели. Помощник (ниже) нужен только для будущих тяжёлых функций.

## Первый запуск с помощником (Windows)

Нужны: Node.js LTS (20.12+), Premiere Pro 25.6+, UXP Developer Tool (через Creative Cloud) и ключ модели:
бесплатный ключ OpenRouter — openrouter.ai → Keys → Create Key (или локальная Ollama без ключа).

1. Установить зависимости (в папке проекта):
   ```bash
   npm install
   ```
2. Запустить помощника — двойной клик по `start-helper.cmd` или:
   ```bash
   npm start
   ```
   При первом запуске создастся `packages/helper/.env`. Впишите туда `OPENROUTER_API_KEY=...`
   и перезапустите помощника. Ключ хранится только в этом файле, в панель он не попадает.
   Чтобы не запускать помощника каждый раз, включите автозапуск — один раз дважды кликните
   `autostart-on.cmd`: помощник будет стартовать сам при входе в Windows, без окна
   (лог — `helper.log`). Выключить — `autostart-off.cmd`, остановить сейчас — `stop-helper.cmd`.
3. Собрать панель:
   ```bash
   npm run build:panel
   ```
4. Premiere Pro: **Preferences (Settings) → Plugins → Enable developer mode**, перезапустить Premiere.
5. UXP Developer Tool → **Add Plugin** → выбрать `packages/panel-premiere/dist/manifest.json` → **Load**.
   После Load панель откроется в Premiere. Если закрыли — ищите её в меню **Window** (раздел UXP-плагинов).
6. Написать в панели «привет» — должен прийти ответ.

## Разработка

- `npm run watch:panel` — пересборка панели при изменениях; в UDT нажмите **Reload** (или включите Watch).
- `npm run dev:helper` — помощник с автоперезапуском при изменениях.
- `npm run dev:browser -w @pa/panel-premiere` — панель в обычном браузере (http://localhost:5173/dev.html)
  для быстрой правки интерфейса. Premiere API там недоступен.
- `npm run typecheck` — проверка типов во всех пакетах.
- Отладка панели: UDT → **Debug** (DevTools с консолью).

## Интерфейс

Вкладки **Чат · Пресеты · Задачи · Настройки**, при первом запуске — экран приветствия с проверкой готовности.
Правила оформления — в разделе «Интерфейс панели» в [CLAUDE.md](CLAUDE.md).

## Как добавить инструмент

- **Инструмент помощника** (Node: файлы, ffmpeg, сеть): новый файл в `packages/helper/src/tools/`,
  например `audio.measure_loudness.ts`, с `export default` объекта `ToolDef` (`runsIn: "helper"`).
  Подхватится при следующем запуске помощника.
- **Host-инструмент** (Premiere API): новый файл `packages/panel-premiere/src/hostTools/premiere.имя.ts`
  с `export default` объекта `HostTool`. Подхватится при следующей сборке панели.
  Перед использованием метода Premiere API — проверить, что он есть в документации.
- Если инструмент что-то меняет — `mutates: true` и функция `describe()`: панель покажет
  карточку подтверждения, без согласия пользователя он не выполнится.

## Настройки помощника (`packages/helper/.env`)

| Переменная | Что это |
| --- | --- |
| `AI_PROVIDER` | `openrouter`, `ollama`, `gemini` или `claude` |
| `OPENROUTER_API_KEY` | ключ OpenRouter (openrouter.ai/keys) |
| `OPENROUTER_MODEL` | пусто — бесплатные модели выбираются автоматически |
| `OLLAMA_MODEL` | локальная модель Ollama (по умолчанию `qwen3:8b`) |
| `GEMINI_API_KEY` | ключ Gemini (aistudio.google.com) |
| `GEMINI_MODEL` | модель Gemini (по умолчанию `gemini-2.5-flash`) |
| `ANTHROPIC_API_KEY` | ключ Anthropic API (platform.claude.com) |
| `CLAUDE_MODEL` | модель Claude (по умолчанию `claude-opus-5-5`) |
| `CLAUDE_EFFORT` | глубина рассуждений: `low` … `max` |
| `CLAUDE_FALLBACKS` | `default` — при отказе модели запрос повторяется на запасной модели; `off` — выключить |
| `HELPER_PORT` | порт (по умолчанию 8765) |

Если меняете порт — укажите его же в настройках панели (вкладка «Настройки»).
