# KB: Study Practice Site

A local study site for interview prep: **20 LLD, 20 HLD and 20 AI / Spring AI** design topics,
each with a write-up and a sketch diagram, plus **Striver's SDE Sheet (189 DSA problems)** grouped by topic.
Write your own answers, then have an AI grade them and talk them through with an AI tutor.
You can do this on the site or from the `kb` command line.

Everything runs on your machine. Content is flat JSON in `content/`. The only network calls are to the AI provider
you choose: **Claude**, **OpenAI** (or any OpenAI-compatible endpoint), or **Ollama** for a free, fully local model.

**Contents:** [Quick start](#quick-start) · [Full setup guide](#full-setup-guide) · [Using the `kb` command](#using-the-kb-command) ·
[Using the site](#using-the-site) · [Where your data is saved](#where-your-data-is-saved) · [Publishing to git](#publishing-to-git) ·
[Troubleshooting](#troubleshooting) · [Project layout](#project-layout)

---

## Quick start

For someone who already has Node and git:

```bash
git clone <repo-url> studykb
cd studykb
npm install
npm link          # makes `kb` a command (or use: node bin/kb.js <command>)
kb setup          # pick Claude / OpenAI / Ollama, paste your API key
kb serve          # open http://localhost:4321
```

The full guide below covers every step in detail.

---

## Full setup guide

### Step 1 — Install the prerequisites

| Tool | Version | Check with | Get it |
|---|---|---|---|
| Node.js | 18 or newer (LTS recommended) | `node -v` | [nodejs.org](https://nodejs.org) — use the LTS installer |
| npm | comes with Node | `npm -v` | installed with Node |
| Git | any recent | `git --version` | [git-scm.com](https://git-scm.com) (only needed to clone or publish) |

On Windows, keep **"Add to PATH"** ticked in the Node installer, then open a *new* terminal so `node` and `npm` are found.

### Step 2 — Get the code

Clone it:

```bash
git clone <repo-url> studykb
cd studykb
```

If you were given a zip instead, unzip it and `cd` into the folder that contains `package.json`.

### Step 3 — Install dependencies

```bash
npm install
```

This installs Express (the local web server) and the editor and diagram libraries. Nothing else is downloaded at runtime,
because the editor and fonts are already vendored in `public/vendor/`.

### Step 4 — Make `kb` available as a command (recommended)

```bash
npm link
```

This adds a global `kb` command that points to this folder. Check that it worked with `kb help`.

If `npm link` isn't allowed on your machine (for example, a locked-down work laptop), skip it and use either of these. They are equivalent:

```bash
node bin/kb.js evaluate lld 1
npm run kb -- evaluate lld 1
```

To undo it later, run `npm unlink -g studykb`.

> **Windows PowerShell:** if `kb` fails with *"running scripts is disabled on this system"*, either call `kb.cmd evaluate lld 1`,
> or allow local scripts once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. Command Prompt (cmd.exe) isn't affected.

### Step 5 — Choose an AI provider and connect it

You only need **one**. You can switch at any time.

#### Option A — Claude (Anthropic)

1. Create a key at [console.anthropic.com → API keys](https://console.anthropic.com/settings/keys). API usage is billed separately from a Claude.ai subscription, so add credit under Billing.
2. Run `kb setup`, choose **1) Claude**, accept the default model (`claude-sonnet-5-5`) or type another, then paste the key.
3. `kb setup` sends a short test message and prints **works** when it succeeds.

Model choices: `claude-sonnet-5-5` (default, good balance), `claude-opus-5-5` (deepest reviews, costs more), `claude-haiku-4-5-20251001` (fastest and cheapest).

#### Option B — OpenAI

1. Create a key at [platform.openai.com → API keys](https://platform.openai.com/api-keys) and make sure the account has credit.
2. Run `kb setup`, choose **2) OpenAI**, enter a model your account can use (default `gpt-5`), keep the base URL, and paste the key.

**Other OpenAI-compatible services** (Azure OpenAI, OpenRouter, LM Studio, Groq and so on) work through this same option.
Enter that service's **base URL** and model name, plus its key if it needs one.

#### Option C — Ollama (free, fully offline)

1. Install Ollama from [ollama.com](https://ollama.com). On Windows and macOS it runs in the background after install. On Linux, run `ollama serve`.
2. Download a model: `ollama pull llama3.1` (others such as `qwen2.5` or `mistral` also work).
3. Run `kb setup`, choose **3) Ollama**, and enter the model name you pulled. No key is needed.

Local models are free and private, but their reviews are noticeably weaker than Claude's or OpenAI's.

#### Setting it up from the site instead

Start the site (Step 6), click **Set up AI** in the top bar, pick a provider, fill in the model and key, then click **Save & test**.
This writes the same `kb.config.json` that `kb setup` does.

#### Using environment variables instead of a saved key

If you'd rather not keep the key in a file, set it in your environment. Environment variables take priority over `kb.config.json`.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude key |
| `OPENAI_API_KEY` | OpenAI key |
| `OPENAI_BASE_URL` | OpenAI-compatible endpoint |
| `OLLAMA_BASE_URL` | Ollama endpoint (default `http://localhost:11434/v1`) |
| `KB_PROVIDER` | `anthropic`, `openai` or `ollama` |
| `KB_MODEL` | model name override |

```powershell
# Windows PowerShell: current window only
$env:ANTHROPIC_API_KEY = "sk-ant-..."
# Windows: permanent (open a new terminal afterwards)
setx ANTHROPIC_API_KEY "sk-ant-..."
```

```bash
# macOS / Linux: add to ~/.zshrc or ~/.bashrc to make it permanent
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Step 6 — Start the site

```bash
kb serve        # or: npm start
```

Open **http://localhost:4321**. The terminal shows which AI is connected:

```
KB running at http://localhost:4321 · AI: anthropic (claude-sonnet-5-5)
```

Keep that terminal open while you study, and press `Ctrl+C` to stop the site. You don't need to restart it after editing files,
because every request reads the JSON fresh.

To use a different port, set `PORT` first: `$env:PORT=5000; npm start` in PowerShell, or `PORT=5000 npm start` in bash.

### Step 7 — Check everything works

```bash
kb status
```

You should see something like:

```
AI       Claude (Anthropic) · claude-sonnet-5-5 · ready
Progress 0/249 attempted · 0/249 evaluated
Nothing pending.
```

### Step 8 (optional) — Start from a clean slate

If you cloned someone else's copy, it may contain their answers and chats. Wipe them, keeping all the write-ups:

```bash
kb reset --yes
```

### Your first session, end to end

1. On the site, open **LLD → 1 Design Chess** and turn on **Practice mode** in the top bar so the write-up stays hidden.
2. Write your design in **My answer** and save it with `Ctrl+S`.
3. Click **Evaluate with AI**. After 10–40 seconds the verdict appears: *Strong / Solid / Partial / Needs work*, followed by what you got right, the gaps and what to study next.
4. Ask a follow-up in **Discuss with the AI tutor**, such as *"Why should Board be separate from Game?"*, or click **Quiz me like an interviewer**.
5. Click **Reveal write-up** to compare your answer with the reference.

The same session from a terminal:

```bash
kb answer lld 1 my-chess.md        # or write it on the site
kb evaluate lld 1
kb clarify lld 1 "why should Board be separate from Game?"
kb chat lld 1                      # back-and-forth; /exit to leave
```

---

## Using the `kb` command

Topics are addressed by track and number: `lld 1`–`lld 20`, `hld 1`–`hld 20`, `ai 1`–`ai 20`, `dsa 1`–`dsa 189`.
`lld1` and `LLD-1` also work. Run `kb list` to see every number.

| Command | What it does |
|---|---|
| `kb evaluate lld 1` | Grades your saved answer and saves the verdict (alias: `kb eval`) |
| `kb clarify lld 1 "question"` | Asks about the topic and continues its conversation (alias: `kb ask`). Quotes are optional |
| `kb chat lld 1` | Interactive conversation. Use `/exit` to quit, `/clear` to reset and `/history` to reprint it |
| `kb history lld 1` | Prints the conversation |
| `kb clear lld 1` | Clears the conversation |
| `kb doubts [lld 1]` | Answers open `#doubt` lines in notes, for every topic if you leave the address off |
| `kb pending` | Lists unevaluated answers and open doubts |
| `kb pending --run` | Evaluates all of those answers and answers all of those doubts |
| `kb list [lld\|hld\|ai\|dsa]` | Lists topics with status: ○ untouched, ◐ attempted, ● evaluated |
| `kb show lld 1 [--writeup]` | Prints your answer and verdict, plus the reference write-up with `--writeup` |
| `kb answer lld 1 file.md` | Saves an answer from a file (`-` reads stdin) and clears any old verdict |
| `kb setup` | Chooses the provider, model and key, then tests the connection |
| `kb status` | Shows the AI settings, progress and pending items |
| `kb serve` | Starts the site |
| `kb reset --yes` | Wipes all answers, verdicts, notes and chats (write-ups stay) |

**One run on a different model:** add `--provider openai`, `--provider ollama` or `--model claude-opus-5-5` to any AI command.
This doesn't change your saved settings.

**The site and the CLI share everything.** A question asked with `kb clarify` appears in that topic's chat on the site, and the reverse.
The same goes for verdicts and doubt answers. Reload the page to see changes made from the terminal.

---

## Using the site

- **Sidebar** (toggle with `\`): grouped LLD / HLD / AI / DSA. Status dots: hollow = untouched, orange = attempted, green = evaluated.
- **Practice mode**: hides the diagram and write-up until you click Reveal, so you can attempt a topic cold.
- **My answer**: a rich editor that saves as Markdown. `Ctrl/⌘ S` saves. Changing a saved answer clears its old verdict.
- **Verdict**: **Evaluate with AI**, or **Re-evaluate** once a verdict exists. Any unsaved edits are saved first.
- **Discuss with the AI tutor**: a streaming chat for each topic. The tutor sees the write-up, your answer and your verdict.
  Quick prompts include *Quiz me like an interviewer* and *What's weakest in my answer?* **Clear** starts the conversation over.
- **Diagrams**: paste (`Ctrl+V`), drag in, or use the toolbar's image button to add a screenshot, an Excalidraw/draw.io export, or a phone photo of a whiteboard.
  Images are saved as files in `content/images/`, and **the AI looks at them** when it evaluates, chats or answers doubts, comparing them against your text.
  This works with Claude, GPT-5 and vision models in Ollama (such as `gemma4`). If a model can't read images, the evaluation still runs and the verdict notes that the diagrams were skipped.
  PNG, JPEG, GIF and WebP are supported, at most 6 images per answer and 5 MB each.
- **Notes & doubts**: free-form notes. Put `#doubt your question` on its own line, then click **Answer with AI**.
  The reply is written under it as `#doubt-answer …`.
- **AI chip** (top bar): shows the connected provider and model. Click it to change settings.

---

## Where your data is saved

Everything is stored in this folder. There's no database and no cloud storage.

| What | Where | In git? |
|---|---|---|
| AI provider, model, API key | `kb.config.json` (created by `kb setup` or the site's settings) | **No**, it's git-ignored |
| Images in your answers | `content/images/` (file names are content hashes) | Yes |
| Answers, verdicts, notes and chats for `lld N`, `hld N`, `ai N` | `content/day-NN.json` (e.g. `lld 1`, `hld 1` and `ai 1` are all in `day-01.json`) | Yes |
| Same for `dsa N` | `content/dsa.json` | Yes |
| Theme, sidebar state, practice mode | browser localStorage | — |

Inside each topic, the fields are `userAnswer`, `answerEvaluation` and `answerEvaluatedAt`, `notes`, and `chat`.
`AUTHORING.md` documents the format.

**What leaves your machine:** only when you use an AI feature. Each request sends that topic's write-up, your answer (including its images),
the verdict and the recent chat (last 24 messages) to your chosen provider. With Ollama, nothing leaves your machine.

**Security:** the server listens only on `127.0.0.1`, because its AI routes spend your credit. Set `HOST=0.0.0.0` only if you
deliberately want other devices on your network to reach it. API keys are never sent to the browser; the settings dialog only shows the last 4 characters.

**Backups:** copy the `content/` folder. Committing to a private git repo also works as a backup.

---

## Publishing to git

`.gitignore` already excludes `node_modules/`, `kb.config.json`, zips, temp files and your sketch images.

```bash
git init
git add .
git commit -m "KB study site"
git branch -M main
git remote add origin https://github.com/<you>/studykb.git
git push -u origin main
```

Before pushing, run `git status` and confirm `kb.config.json` is **not** listed.

Your answers and chats live in `content/`, so they get committed too. That's fine for a private repo.
For a public repo, publish from a separate copy where you've run `kb reset --yes`, so others start clean and your work stays private.

`.gitattributes` keeps every file on LF line endings, so the JSON diffs stay readable across Windows and macOS.

**Pulling updates later:** run `git pull` and then `npm install`. Your `kb.config.json` is untouched.
If an update edits the same topic file as your answers, git asks you to resolve the conflict.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `kb` is not recognized | Run `npm link` again from the project folder and open a new terminal, or use `node bin/kb.js …` |
| PowerShell: *running scripts is disabled* | Use `kb.cmd …`, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| *No API key for Claude* | Run `kb setup`, or click **Set up AI** on the site |
| *rejected the API key (401/403)* | The key is wrong or revoked. Paste it again with `kb setup` |
| *Model "…" not found (404)* | Your account can't use that model. Pick another in `kb setup` or the site's settings |
| *Rate limited or out of credit (429)* | Add credit or billing in the provider console, or wait a minute |
| *Can't reach api.anthropic.com / api.openai.com* | You're offline, or a VPN or corporate proxy is blocking the call. Try another network, or use Ollama |
| *Can't reach Ollama* | Start Ollama (`ollama serve`) and check the model is pulled with `ollama list` |
| *EADDRINUSE* when starting | Port 4321 is busy. Use `PORT=5000 npm start` (bash) or `$env:PORT=5000; npm start` (PowerShell) |
| Changes from the CLI don't show on the site | Reload the page. The site reads files fresh on every load |
| *no answer saved yet* | Save an answer on the site first, or use `kb answer lld 1 file.md` |
| Want a fresh start | `kb reset --yes` |

---

## Project layout

```
server.js                Express: static files + JSON API + AI routes (Cache-Control: no-store everywhere)
bin/kb.js                the `kb` command
lib/store.js             read/write content JSON; addresses like "lld 1"
lib/ai.js                provider layer (Claude, OpenAI-compatible, Ollama), streaming, kb.config.json
lib/tutor.js             evaluate / clarify / doubts, with the prompts, shared by the CLI and the server
lib/images.js            answer images: save to content/images, attach to prompts as real image inputs
public/                  index.html, app.js, diagram.js (rough.js renderer), styles.css, vendor/
content/day-NN.json      3 topics per file (LLD, HLD, AI): write-up, diagram, your answer, verdict, notes, chat
content/dsa.json         SDE sheet, regrouped by topic
build/                   assemble.js + topics/*.txt (source for all 60 write-ups), make-dsa.py, toastui-entry.js
scripts/                 new-day.js, study-parser.js, generate-day.sh (older Claude Code CLI workflow), pending.js
AUTHORING.md             the JSON contract, for anyone (or any assistant) editing content by hand
kb.config.example.json   example AI settings file
```

### Rebuilding content and the editor

- `npm run build:content` rebuilds `content/day-*.json` from `build/topics/*.txt`. It keeps your answers, notes, verdicts and chats.
- `build/make-dsa.py` regenerates `dsa.json` and **wipes DSA answers**.
- `npm run build:editor` re-bundles the vendored Toast UI editor. The raw npm `dist` file breaks in a plain `<script>` tag, so it's bundled with esbuild.

## About the DSA list

It was reconstructed from knowledge of Striver's SDE Sheet (189 problems), not copied from the live sheet.
LeetCode links are given only where a confident 1:1 match exists (123 of 189). The rest are GFG, Coding Ninjas,
or classic algorithm exercises with no exact LeetCode equivalent, and have no link. Numbering is global (1–189) in topic order.
