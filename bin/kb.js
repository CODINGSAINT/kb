#!/usr/bin/env node
// kb — command line for the KB study site. Run `kb help`.
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const store = require("../lib/store");
const ai = require("../lib/ai");
const tutor = require("../lib/tutor");

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = c(2), bold = c(1), green = c(32), yellow = c(33), red = c(31), cyan = c(36);

const HELP = `${bold("kb")} — study from the terminal. The site and the CLI share the same files and conversations.

${bold("Setup")}
  kb setup                         pick Claude / OpenAI / Ollama, model and API key
  kb status                        AI settings, progress and what's waiting
  kb serve                         start the site at http://localhost:4321

${bold("Study")}
  kb list [lld|hld|ai|dsa]         topics with status   ${dim("○ untouched  ◐ attempted  ● evaluated")}
  kb show lld 1 [--writeup]        your answer and verdict (add --writeup for the reference)
  kb answer lld 1 <file.md>        save an answer from a file ("-" reads stdin)

${bold("AI")}
  kb evaluate lld 1                grade your saved answer and save the verdict   ${dim("(alias: eval)")}
  kb clarify lld 1 <question>      ask about the topic; continues its conversation ${dim("(alias: ask)")}
  kb chat lld 1                    interactive conversation (/exit to quit, /clear to reset)
  kb history lld 1                 print the conversation
  kb clear lld 1                   clear the conversation
  kb doubts [lld 1]                answer open "#doubt" lines in notes (all topics if none given)
  kb pending [--run]               list what's waiting; --run evaluates and answers all of it

${bold("Housekeeping")}
  kb reset --yes                   wipe all answers, verdicts, notes and chats (write-ups stay)

${bold("Addresses")}   lld 1-20 · hld 1-20 · ai 1-20 · dsa 1-189     ${dim('("lld1", "LLD-1" also work)')}
${bold("Options")}     --provider anthropic|openai|ollama   --model <name>   (one run only)
`;

// ---------- arg parsing ----------
function parseArgs(argv) {
  const opts = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--provider" || a === "--model") opts[a.slice(2)] = argv[++i];
    else if (a.startsWith("--provider=") || a.startsWith("--model=")) { const [k, v] = a.slice(2).split("="); opts[k] = v; }
    else if (["--writeup", "--run", "--yes", "-h", "--help"].includes(a)) opts[a.replace(/^-+/, "")] = true;
    else rest.push(a);
  }
  return { opts, rest };
}
// Accepts ["lld","1", ...rest] or ["lld1", ...rest]. Returns { addr, rest }.
function takeAddress(args) {
  if (!args.length) throw new Error("Which topic? e.g. lld 1");
  if (/^(lld|hld|ai|dsa)$/i.test(args[0]) && args[1] && /^\d+$/.test(args[1])) return { addr: store.parseAddress(args.slice(0, 2)), rest: args.slice(2) };
  return { addr: store.parseAddress(args[0]), rest: args.slice(1) };
}
const aiOpts = (o) => ({ provider: o.provider, model: o.model });

function header(it) {
  const where = it.track === "DSA" ? `${it.topicName}` : `day ${it.day} · ${it.concepts}`;
  console.log(`${bold(it.label)}  ${dim(where)}`);
}
function modelLine(o) {
  const s = ai.resolve(aiOpts(o));
  return dim(`[${s.provider} · ${s.model}]`);
}
const stream = (t) => process.stdout.write(t);
function prompt(rl, q) { return new Promise((r) => rl.question(q, r)); }

// ---------- commands ----------
const commands = {
  help() { console.log(HELP); },

  async setup() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const cur = ai.publicConfig();
    const ids = Object.keys(ai.PROVIDERS);
    console.log(bold("AI provider for evaluation and chat\n"));
    ids.forEach((id, i) => console.log(`  ${i + 1}) ${ai.PROVIDERS[id].name}${id === cur.provider ? dim("  (current)") : ""}`));
    const pick = (await prompt(rl, `\nChoose 1-${ids.length} [${ids.indexOf(cur.provider) + 1}]: `)).trim();
    const provider = pick ? ids[Number(pick) - 1] : cur.provider;
    if (!provider) { rl.close(); throw new Error("Not a valid choice."); }
    const p = cur.providers[provider];
    const patch = { provider, [provider]: {} };
    const model = (await prompt(rl, `Model ${dim("(e.g. " + p.models.join(", ") + ")")} [${p.model}]: `)).trim();
    if (model) patch[provider].model = model;
    if (p.baseUrl && provider !== "anthropic") {
      const url = (await prompt(rl, `Base URL [${p.baseUrl}]: `)).trim();
      if (url) patch[provider].baseUrl = url;
    }
    if (ai.PROVIDERS[provider].needsKey) {
      console.log(dim(`Get a key at ${p.keyUrl}`));
      const key = (await prompt(rl, `API key ${p.keySet ? dim(`[keep ${p.keyHint}]`) : ""}: `)).trim();
      if (key) patch[provider].apiKey = key;
    }
    rl.close();
    ai.saveConfig(patch);
    console.log(green(`\nSaved to kb.config.json`) + dim(" (git-ignored, stays on this machine)."));
    process.stdout.write("Testing… ");
    try {
      const r = await ai.complete({ system: "Reply with exactly: OK", messages: [{ role: "user", content: "ping" }], maxTokens: 20 });
      console.log(green("works") + dim(` (${r.trim().slice(0, 30)})`));
    } catch (e) { console.log(red("failed: " + e.message)); process.exitCode = 1; }
  },

  status(o) {
    const cfg = ai.publicConfig();
    const p = cfg.providers[cfg.provider];
    console.log(`${bold("AI")}       ${p ? p.name : cfg.provider} · ${cfg.model} · ${cfg.ready ? green("ready") : yellow("needs an API key — run kb setup")}`);
    const items = store.listItems();
    const n = items.length, a = items.filter((i) => i.answered).length, e = items.filter((i) => i.evaluated).length;
    console.log(`${bold("Progress")} ${a}/${n} attempted · ${e}/${n} evaluated`);
    commands.pending(o);
  },

  list(o, args) {
    const tr = args[0];
    if (tr && !/^(lld|hld|ai|dsa)$/i.test(tr)) throw new Error("kb list [lld|hld|ai|dsa]");
    let group = null;
    for (const it of store.listItems(tr)) {
      const g = it.track === "DSA" ? `DSA — ${it.group}` : it.track;
      if (g !== group) { group = g; console.log("\n" + bold(g)); }
      const mark = it.evaluated ? green("●") : it.answered ? yellow("◐") : dim("○");
      const extra = [it.chatCount ? dim(`${it.chatCount / 2 | 0} chat`) : "", it.openDoubts ? yellow(`${it.openDoubts} doubt`) : ""].filter(Boolean).join(" ");
      console.log(`  ${mark} ${String(it.number).padStart(3)}  ${it.title} ${extra}`);
    }
  },

  show(o, args) {
    const { addr } = takeAddress(args);
    const it = store.getItem(addr);
    header(it);
    if (it.leetcodeUrl) console.log(dim(it.leetcodeUrl));
    if (o.writeup && it.markdown) console.log("\n" + cyan("── Reference write-up ──") + "\n" + it.markdown.trim());
    console.log("\n" + cyan("── Your answer ──") + "\n" + (it.userAnswer.trim() || dim("(none saved)")));
    console.log("\n" + cyan("── Verdict ──") + "\n" + (it.answerEvaluation ? it.answerEvaluation.trim() + "\n" + dim(it.answerEvaluatedAt) : dim(`(not evaluated — kb evaluate ${addr.track.toLowerCase()} ${addr.number})`)));
    if (it.chat.length) console.log("\n" + dim(`${it.chat.length} chat messages — kb history ${addr.track.toLowerCase()} ${addr.number}`));
  },

  answer(o, args) {
    const { addr, rest } = takeAddress(args);
    const src = rest[0];
    if (!src) throw new Error("kb answer lld 1 <file.md>   (or - to read stdin)");
    const md = src === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path.resolve(src), "utf8");
    store.updateItem(addr, (t) => {
      if (t.userAnswer !== md) { t.answerEvaluation = null; t.answerEvaluatedAt = null; }
      t.userAnswer = md;
    });
    console.log(green(`Saved answer for ${store.addrLabel(addr)}`) + dim(` (${md.length} chars). Next: kb evaluate ${addr.track.toLowerCase()} ${addr.number}`));
  },

  async evaluate(o, args) {
    const { addr } = takeAddress(args);
    const it = store.getItem(addr);
    header(it);
    if (!it.userAnswer.trim()) throw new Error(`No answer saved for ${store.addrLabel(addr)} yet. Write one on the site, or: kb answer ${addr.track.toLowerCase()} ${addr.number} my-answer.md`);
    console.log(dim(`Evaluating your answer… `) + modelLine(o) + "\n");
    await tutor.evaluate(addr, { ...aiOpts(o), onToken: stream });
    console.log("\n\n" + green("Saved verdict.") + dim(" It's on the site too (reload the page)."));
  },

  async clarify(o, args) {
    const { addr, rest } = takeAddress(args);
    let q = rest.join(" ").trim();
    if (!q && !process.stdin.isTTY) q = fs.readFileSync(0, "utf8").trim();
    if (!q) throw new Error(`kb clarify ${addr.track.toLowerCase()} ${addr.number} "your question"`);
    const it = store.getItem(addr);
    header(it);
    console.log(modelLine(o) + (it.chat.length ? dim(` · continuing a ${it.chat.length}-message conversation`) : "") + "\n");
    await tutor.clarify(addr, q, { ...aiOpts(o), onToken: stream });
    process.stdout.write("\n");
  },

  async chat(o, args) {
    const { addr } = takeAddress(args);
    const it = store.getItem(addr);
    header(it);
    console.log(modelLine(o) + dim("  /exit to quit · /clear to reset · /history to reprint"));
    for (const m of it.chat.slice(-6)) printTurn(m);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    for (;;) {
      const q = (await prompt(rl, "\n" + bold(cyan("you › ")))).trim();
      if (!q) continue;
      if (q === "/exit" || q === "/quit") break;
      if (q === "/clear") { tutor.clearChat(addr); console.log(dim("Conversation cleared.")); continue; }
      if (q === "/history") { store.getItem(addr).chat.forEach(printTurn); continue; }
      process.stdout.write("\n" + bold(green("tutor › ")));
      try { await tutor.clarify(addr, q, { ...aiOpts(o), onToken: stream }); process.stdout.write("\n"); }
      catch (e) { console.log(red(e.message)); }
    }
    rl.close();
  },

  history(o, args) {
    const { addr } = takeAddress(args);
    const it = store.getItem(addr);
    header(it);
    if (!it.chat.length) return console.log(dim("No conversation yet."));
    it.chat.forEach(printTurn);
  },

  clear(o, args) {
    const { addr } = takeAddress(args);
    tutor.clearChat(addr);
    console.log(green(`Cleared the conversation for ${store.addrLabel(addr)}.`));
  },

  async doubts(o, args) {
    const targets = args.length ? [takeAddress(args).addr] : store.pending().filter((r) => r.kind === "doubts").map((r) => ({ track: r.track, number: r.number }));
    if (!targets.length) return console.log("No open #doubt lines.");
    for (const addr of targets) {
      const it = store.getItem(addr);
      header(it);
      const r = await tutor.answerDoubts(addr, { ...aiOpts(o), onDoubt: (q, a) => console.log(`  ${cyan("Q.")} ${q}\n  ${green("A.")} ${a.trim().replace(/\n/g, "\n     ")}\n`) });
      if (!r.answered) console.log(dim("  no open doubts"));
    }
    console.log(green("Answers written into notes."));
  },

  async pending(o) {
    const rows = store.pending();
    if (!rows.length) return console.log("Nothing pending.");
    if (!o.run) {
      console.log(bold("Waiting"));
      for (const r of rows) console.log(`  ${r.kind === "evaluate" ? yellow("evaluate") : cyan(`${r.count} doubt${r.count > 1 ? "s" : ""}`)}  ${r.track.toLowerCase()} ${r.number}  ${dim(r.title)}`);
      return console.log(dim("\nkb pending --run handles all of these."));
    }
    for (const r of rows) {
      const addr = { track: r.track, number: r.number };
      try {
        if (r.kind === "evaluate") {
          process.stdout.write(`Evaluating ${store.addrLabel(addr)} … `);
          const { verdict } = await tutor.evaluate(addr, aiOpts(o));
          console.log(green(verdict.split("\n")[0].replace(/\*/g, "")));
        } else {
          process.stdout.write(`Answering doubts on ${store.addrLabel(addr)} … `);
          const { answered } = await tutor.answerDoubts(addr, aiOpts(o));
          console.log(green(`${answered} answered`));
        }
      } catch (e) { console.log(red(e.message)); process.exitCode = 1; }
    }
  },

  reset(o, args) {
    if (!args.includes("--yes") && !o.yes) {
      console.log(`This wipes ${bold("all")} saved answers, verdicts, notes and conversations (the write-ups stay).\nRun ${bold("kb reset --yes")} to confirm. Handy after cloning someone else's copy.`);
      return;
    }
    const wipe = (t) => { t.userAnswer = ""; t.answerEvaluation = null; t.answerEvaluatedAt = null; t.notes = ""; delete t.chat; };
    let n = 0;
    for (const f of store.dayFiles()) {
      const d = store.readJson(f);
      (d.topics || []).forEach((t) => { wipe(t); n++; });
      d.sketch = null; d.evaluation = null;
      store.writeJson(f, d);
    }
    const dsa = store.readJson(store.DSA_FILE);
    dsa.topics.forEach((tp) => tp.problems.forEach((p) => { wipe(p); n++; }));
    store.writeJson(store.DSA_FILE, dsa);
    console.log(green(`Reset ${n} topics and problems to a clean slate.`));
  },

  serve() { require("../server"); },
};
const aliases = { eval: "evaluate", ask: "clarify", ls: "list", "-h": "help", "--help": "help", start: "serve", config: "setup" };

function printTurn(m) {
  const who = m.role === "user" ? bold(cyan("you › ")) : bold(green("tutor › "));
  console.log("\n" + who + m.content);
}

(async function main() {
  const [cmdRaw, ...argv] = process.argv.slice(2);
  const cmd = aliases[cmdRaw] || cmdRaw || "help";
  const { opts, rest } = parseArgs(argv);
  if (!commands[cmd]) { console.error(red(`Unknown command "${cmdRaw}".`) + "\n"); console.log(HELP); process.exit(1); }
  if (opts.help) return commands.help();
  try { await commands[cmd](opts, rest); }
  catch (e) { console.error("\n" + red(e.message)); process.exit(1); }
})();
