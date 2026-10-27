(() => {
  "use strict";

  const tokens = ["NO", "YES", "UNSURE"];
  const suffixes = ["no", "yes", "unsure"];
  const fixtures = {
    "no-leads": {
      base: [0.6, 0.3, 0.1],
      note: "NO leads, matching the source for this toy question. This does not mean every sampled token will match."
    },
    "yes-leads": {
      base: [0.3, 0.6, 0.1],
      note: "YES leads, contradicting the source. Lower temperature makes this wrong leader more likely; it does not fix the scores."
    },
    tie: {
      base: [0.45, 0.45, 0.1],
      note: "NO and YES have equal leading scores. At positive T they retain equal probability; our greedy tie rule chooses the first index, NO."
    }
  };

  const get = id => document.getElementById(id);
  const fixtureControl = get("fixture");
  const temperatureControl = get("temperature");
  const status = get("status");
  let current = [0.6, 0.3, 0.1];
  let counts = [0, 0, 0];

  function probabilities(base, temperature) {
    const logits = base.map(value => Math.log(value));
    const maximum = Math.max(...logits);
    if (temperature === 0) {
      return logits.map((_, index) => index === logits.indexOf(maximum) ? 1 : 0);
    }
    const weights = logits.map(logit => Math.exp((logit - maximum) / temperature));
    const sum = weights.reduce((total, value) => total + value, 0);
    return weights.map(value => value / sum);
  }

  function entropyBits(distribution) {
    return distribution.reduce((sum, p) => p === 0 ? sum : sum - p * Math.log2(p), 0);
  }

  function percent(p) {
    if (p > 0 && p * 100 < 0.001) return "<0.001%";
    return `${(p * 100).toFixed(3)}%`;
  }

  function renderCounts() {
    suffixes.forEach((suffix, index) => {
      get(`count-${suffix}`).textContent = String(counts[index]);
    });
  }

  function setDistribution(initial = false) {
    const fixture = fixtures[fixtureControl.value];
    const temperature = Number(temperatureControl.value);
    current = probabilities(fixture.base, temperature);
    counts = [0, 0, 0];
    renderCounts();
    const temperatureText = temperature === 0 ? "0 — greedy" : temperature.toFixed(1);
    get("temperature-value").textContent = temperatureText;
    temperatureControl.setAttribute("aria-valuetext", temperatureText);
    get("fixture-note").textContent = fixture.note;
    suffixes.forEach((suffix, index) => {
      get(`base-${suffix}`).textContent = percent(fixture.base[index]);
      get(`prob-${suffix}`).textContent = percent(current[index]);
      get(`bar-${suffix}`).style.width = `${current[index] * 100}%`;
    });
    const maximumBase = Math.max(...fixture.base);
    const leaders = tokens.filter((_, index) => fixture.base[index] === maximumBase);
    get("leader").textContent = leaders.length === 1 ? leaders[0] : `${leaders.join(" / ")} (tie)`;
    get("entropy").textContent = `${entropyBits(current).toFixed(6)} bits`;
    get("sum").textContent = current.reduce((sum, p) => sum + p, 0).toFixed(6);
    status.textContent = initial
      ? "No samples drawn. Source answer remains NO."
      : `Settings changed to T = ${temperatureText}. Samples cleared. ${fixture.note} Source answer remains NO.`;
  }

  function sample(distribution) {
    const draw = Math.random();
    let cumulative = 0;
    for (let index = 0; index < distribution.length; index += 1) {
      cumulative += distribution[index];
      if (draw < cumulative) return index;
    }
    // Floating-point totals may finish just below one; use the last nonzero bin.
    for (let index = distribution.length - 1; index >= 0; index -= 1) {
      if (distribution[index] > 0) return index;
    }
    throw new Error("Toy distribution has no mass");
  }

  function drawSamples(amount) {
    let last = 0;
    for (let draw = 0; draw < amount; draw += 1) {
      last = sample(current);
      counts[last] += 1;
    }
    renderCounts();
    const total = counts.reduce((sum, count) => sum + count, 0);
    const lastMeaning = last === 0
      ? "This token matches the source in our toy task."
      : last === 1
        ? "This token contradicts the source in our toy task."
        : "This token abstains despite this toy task having an answer.";
    status.textContent = `${amount} independent ${amount === 1 ? "draw" : "draws"} added; ${total} total. `
      + `Counts: NO ${counts[0]}, YES ${counts[1]}, UNSURE ${counts[2]}. `
      + `Last token: ${tokens[last]}. ${lastMeaning} Source answer remains NO.`;
  }

  fixtureControl.addEventListener("change", () => setDistribution());
  temperatureControl.addEventListener("input", () => setDistribution());
  get("draw-one").addEventListener("click", () => drawSamples(1));
  get("draw-many").addEventListener("click", () => drawSamples(100));
  get("clear").addEventListener("click", () => {
    counts = [0, 0, 0];
    renderCounts();
    status.textContent = "Samples cleared. The distribution is unchanged. Source answer remains NO.";
  });

  const themeButton = get("theme");
  const preferredDark = window.matchMedia("(prefers-color-scheme: dark)");
  function storedTheme() {
    try {
      const value = localStorage.getItem("kb-theme");
      return value === "light" || value === "dark" ? value : null;
    } catch (_) {
      return null;
    }
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeButton.textContent = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  }
  function refreshTheme() {
    applyTheme(storedTheme() || (preferredDark.matches ? "dark" : "light"));
  }
  themeButton.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("kb-theme", next); } catch (_) { /* In-memory toggle still works. */ }
    applyTheme(next);
  });
  window.addEventListener("storage", event => {
    if (event.key === "kb-theme" || event.key === null) refreshTheme();
  });
  preferredDark.addEventListener("change", () => {
    if (!storedTheme()) refreshTheme();
  });

  refreshTheme();
  setDistribution(true);
})();
