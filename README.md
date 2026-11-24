# Studydeck

[![CI](https://github.com/pixels-ux/studydeck/actions/workflows/ci.yml/badge.svg)](https://github.com/pixels-ux/studydeck/actions/workflows/ci.yml)

A timetable, work and syllabus organiser for CBSE/NCERT students. Tell it your
class, your subjects and your test dates; it lays out your week and an exam
revision plan, then keeps assignments, chapters and notes in one workspace.

It runs on your own computer. Clone it, run two commands, and everything —
timetable, notes, tasks, your AI key — lives in a single file in the project
folder. No account, no server to sign up for, nothing sent anywhere except the
AI requests you ask for yourself.

![The Today screen, showing the day's classes and what is due](docs/screenshots/today.png)

## Run it

You need [Bun](https://bun.sh) (or Node 22.5+ and npm).

```sh
git clone https://github.com/pixels-ux/studydeck.git
cd studydeck
bun install
bun run dev
```

Open <http://localhost:3000>. The first run asks for your class and subjects,
then builds your week. `bun run dev` reloads the page as you edit the code.

For a single build you can start at any time:

```sh
bun run build     # client into dist/client, server into dist/server
bun start         # http://localhost:3000
```

## What it does

- **Class setup** — your class, subjects and colours, your school timetable
  (type it period by period), optional coaching days, test dates, and how many
  hours you can study. A weekly timetable and an intensive revision plan are
  built from that.
- **Today** — a check-in for the day just taught, tonight's plan, the classes
  you have, the work that is due and the exams coming up.
- **Your day** — say what was actually covered in school and at coaching, what
  homework was set and how much, then get an evening plan with breaks sized to
  the backlog. An AI brief comments on it if a key is connected.
- **Timetable** — your week as a grid with rooms, teachers and subject colours,
  plus the revision plan. Study sessions never land on a school class, and the
  nearest exam gets the most time.
- **Work** — assignments with due dates and priorities, grouped into overdue,
  today and next week.
- **Syllabus** — NCERT chapters ticked off per subject.
- **Notes** — private notes per subject.
- **Library** — your own material: paste a chapter or add a text file, search
  inside it, ask questions answered only from it with citations, and turn it
  into revision notes or practice questions.
- **Your data** — download subjects, timetable, tasks, notes, day check-ins
  (with their AI briefs), syllabus, library material and the library
  conversations about it as one JSON file, or delete the whole workspace.
- **Calendar** — export the week and the revision plan as an `.ics` file for
  Google Calendar, Apple Calendar or Outlook.
- **AI study desk** — summarise your notes into revision points, or ask a
  question answered only from your own notes, with the note it used. It knows
  your class and chapters. Capped at 40 actions a day.

## Your data

Everything is stored in `data/studydeck.db` next to the project, created on
first run. Copy the file to back it up, move it to another computer, or delete it
to start over. `DATABASE_PATH` points somewhere else if you prefer:

```sh
DATABASE_PATH=~/Documents/studydeck.db bun run dev
```

The in-app **Download a backup** button in Class setup writes the same content as
JSON — day check-ins and the library's questions and answers included — and
**Delete everything** empties the file without touching your notes in any other
app.

There is no login: the app trusts whoever can open <http://localhost:3000>. It
binds to all interfaces by default so it works in a container; on a shared
machine use `HOST=127.0.0.1 bun start` to keep it loopback-only.

## Your day

**Check in your day** sits at the top of Today and takes four short steps:

1. **School** — today's periods from your timetable, each with the topic that
   was taught. **No school today** clears them. A topic becomes a 20-minute
   review block in the evening.
2. **Coaching** — whether you went, the start and end time, and what was done
   there.
3. **Homework** — tasks for school and for coaching separately, each with the
   minutes it will take, and a **No school homework** / **No coaching homework**
   button when nothing was set. Homework is split into blocks of at most 45
   minutes, and a subject is never left with a five-minute scrap.
4. **Tonight** — when you are free and when you stop. Studydeck lays out the
   evening: reviews first, then homework, then whatever time is left goes to the
   subjects furthest behind.

Breaks are not fixed. They start at 10 minutes and grow when there is overdue
work, a lot of un-ticked chapters, 90 minutes or more of homework, or several
new topics in one day, up to 20 minutes. If homework does not fit the window it
is reported instead of being squeezed in.

**Save and build tonight's plan** stores the check-in and replaces only today's
blocks in the timetable; other days are untouched. With an AI key, **Ask AI
about today** adds a short brief: what to start with, what deserves ten minutes
of review, one honest note about the backlog, and two questions to check your own
understanding. The check-in and brief are included in the workspace reset.

## Library

The library is a small notebook for material you are studying from. Open
**Library**, paste a chapter or choose a `.txt`/`.md` file, and give it a
subject. Then:

- **Find** searches every paragraph and shows the sentence around the match.
- **Ask** sends only the paragraphs that match your question and asks for an
  answer from them alone. The answer cites them as `[1]`, `[2]` and a chip under
  it names the material used. The conversation is kept per subject, and **Start
  over** clears it.
- **Summarise** and **Practice questions** turn one item into a study note saved
  in Notes, ready to edit.

Matching is by keyword: material is cut into paragraphs, and the paragraphs
sharing the rarest words with your question are the ones sent. Nothing is
embedded or uploaded for indexing, so there is no vector database to install.
Limits are 200 items at 20,000 characters each, and AI work shares the same 40
actions a day. Adding, reading and searching material needs no AI key; asking
and transforming do.

The notebook idea, with sources, cited chat, search and transformations, is
adapted from [Open Notebook](https://github.com/lfnovo/open-notebook) (MIT) and
reimplemented for one local workspace on SQLite.

## AI study desk

The desk is optional and off until you give it a key. Open **AI study desk** and
use **Your own API key** at the bottom of the page: pick a service, paste a key,
and save. The key is stored in your data file, never sent back to the browser,
and used only for your own questions.

| Service | Where to get a key | Default model |
| --- | --- | --- |
| OpenRouter | openrouter.ai/keys | `openrouter/auto` |
| Google Gemini | aistudio.google.com/apikey | `gemini-2.5-flash` |
| Groq | console.groq.com/keys | `llama-3.3-70b-versatile` |
| OpenAI | platform.openai.com/api-keys | `gpt-4o-mini` |
| Mistral | console.mistral.ai/api-keys | `mistral-small-latest` |
| DeepSeek | platform.deepseek.com/api_keys | `deepseek-chat` |
| Together | api.together.ai/settings/api-keys | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| Freebuff | freebuff.com/account/api | allowlisted models |
| Ollama | nothing to sign up for | `llama3.2` |
| Anything else | any OpenAI-compatible endpoint | your model |

Any service that speaks the OpenAI chat-completions API works; pick *Other* and
give it a base URL and a model.

### Ollama, entirely offline

```sh
ollama pull llama3.2
ollama serve
```

Then in the app pick **Ollama on this server**, leave the key empty, and save. If
Ollama runs elsewhere, set the base URL (for example
`http://192.168.1.20:11434/v1`).

### Keys from the environment instead

The desk also reads keys at startup, which is handy for a scripted setup. A key
saved in the app wins over these.

| Variable | Purpose |
| --- | --- |
| `AI_PROVIDER` | `openrouter`, `gemini`, `groq`, `openai`, `mistral`, `deepseek`, `together`, `freebuff`, `custom` or `ollama`. |
| `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `TOGETHER_API_KEY` | Provider keys. |
| `OPENAI_API_KEY` | A Freebuff key by default; an OpenAI key with `AI_PROVIDER=openai`. |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Point at a local Ollama. No key needed. |
| `AI_BASE_URL`, `AI_MODEL` | Any OpenAI-compatible endpoint, and the model name. |
| `DATABASE_PATH` | Where the data file lives, default `data/studydeck.db`. |
| `PORT`, `HOST` | Default `3000` and `0.0.0.0`. |

With no `AI_PROVIDER`, the first key that is set wins in the order OpenRouter,
Groq, Gemini, DeepSeek, Mistral, Together, Freebuff. Bun reads `.env` by itself;
for the built server use `node --env-file=.env dist/server/server.js`. Copy
`.env.example` to start. `.env` and `data/` are gitignored.

## Stack

- React 19 and Vite for the interface (`src/client`).
- A Hono app for the API (`src/server/app.ts`), mounted into a small Node HTTP
  server that also serves the built client (`src/node/server.ts`). In
  development a Vite middleware mounts the same app, so `bun run dev` is one
  process on one origin.
- SQL through a small surface, `prepare` / `bind` / `first` / `all` / `run` /
  `batch` (`src/server/sql.ts`), implemented over `node:sqlite` on a local file
  (`src/node/sqlite.ts`).
- No third-party services, no telemetry, no accounts.

## Project layout

```
src/client/    React pages, styles and the plan generator
src/shared/    Types and the NCERT curriculum shared by browser and server
src/server/    Hono app, schema, SQL surface, AI desk, calendar export
src/node/      Node HTTP server, SQLite adapter, Vite dev middleware
tests/         API, planning, calendar and provider tests
```

## Tests

```sh
bun test           # API against the real SQLite engine, planning, calendar
bun run typecheck  # client, server and test projects
```

The API tests open an in-memory SQLite database and exercise the routes: setup,
CRUD, validation, cross-origin writes, export, calendar and the AI key settings.
They run in CI on every push to `main` and on every pull request
(`.github/workflows/ci.yml`).

## License

[MIT](LICENSE).
