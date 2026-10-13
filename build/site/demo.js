// Read-only demo for GitHub Pages. Loaded before app.js only in the static build (npm run build:site).
// There is no server: the page's /api/... reads are answered from static JSON files built from content/,
// and anything that would save or call an AI is refused. No keys, no personal data.
(function () {
  "use strict";
  window.KB_DEMO = { repo: "https://github.com/CODINGSAINT/kb" };

  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
  const READ_ONLY = { error: "This is a read-only demo. Clone the repo to write answers and use the AI tutor.", code: "DEMO" };
  const realFetch = window.fetch.bind(window);

  const ROUTES = [
    [/^\/api\/tracks$/, () => "data/tracks.json"],
    [/^\/api\/dsa$/, () => "data/dsa.json"],
    [/^\/api\/fundamentals$/, () => "data/fundamentals.json"],
    [/^\/api\/days\/(\d+)$/, (m) => `data/days/day-${String(m[1]).padStart(2, "0")}.json`],
  ];

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const path = url.startsWith("/api/") ? url.split("?")[0] : null;
    if (!path) return realFetch(input, init);
    const method = ((init && init.method) || "GET").toUpperCase();
    if (method !== "GET") return Promise.resolve(json(READ_ONLY, 403));
    if (path === "/api/progress") return Promise.resolve(json({ totalTopics: 0, answered: 0, evaluated: 0, answeredPct: 0, evaluatedPct: 0 }));
    if (path === "/api/ai/config") return Promise.resolve(json({ ready: false, demo: true, provider: null, model: null, providers: {} }));
    for (const [re, file] of ROUTES) {
      const m = re.exec(path);
      if (m) return realFetch(file(m), { cache: "no-cache" });
    }
    return Promise.resolve(json({ error: "Not available in the demo." }, 404));
  };

  // A small banner in the top bar linking to the repo.
  document.addEventListener("DOMContentLoaded", () => {
    const bar = document.querySelector(".topbar");
    if (!bar) return;
    const b = document.createElement("div");
    b.className = "demo-banner";
    b.innerHTML = `<span>Read-only demo</span><a href="${window.KB_DEMO.repo}" target="_blank" rel="noopener">Get the full app on GitHub &#8599;</a>`;
    const theme = document.getElementById("themeToggle");
    bar.insertBefore(b, theme || null);
  });
})();
