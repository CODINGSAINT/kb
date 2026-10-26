(() => {
  "use strict";
  const get = id => document.getElementById(id);
  const good = `{
  "schemaVersion": 1,
  "sourceId": "R17",
  "merchant": "Desk Supply Co.",
  "quantity": 3,
  "currency": "INR",
  "unitPrice": 199.50,
  "total": 598.50,
  "purchaseDate": null,
  "category": "OFFICE",
  "evidenceQuote": "Unit price INR 199.50; total INR 598.50."
}`;
  const badTotal = good.replace('"total": 598.50', '"total": 590.00');
  const extra = good.replace('"schemaVersion": 1,', '"schemaVersion": 1,\n  "approved": true,');
  const malformed = '{"schemaVersion": 1,';
  const wrongFacts = good.replace('"unitPrice": 199.50', '"unitPrice": 1.00')
    .replace('"total": 598.50', '"total": 3.00');
  const frame = (title, note, gate, raw, calls = 1) => ({ title, note, gate, raw, calls });
  const scenarios = {
    good: [
      frame("Receive bounded raw text", "The returned text is nonempty, within the example cap and not marked as truncated. It is still an untrusted candidate.", "raw", good),
      frame("Convert the record", "All required keys are present; types, enum names and explicit null date fit the local contract. Extra keys or silent scalar coercions are not allowed.", "parse", good),
      frame("Check the values", "3 × 199.50 = 598.50. The supported currency, merchant and exact quote pass the implemented checks. An unknown purchase date is acceptable for this task.", "validate", good),
      frame("READY_FOR_REVIEW", "Release the candidate beside the original source for a person to verify. Passing these checks does not establish every extracted fact or authorize posting.", "result", good)
    ],
    "bad-total": [
      frame("Receive bounded raw text", "The total is 590.00. JSON syntax alone cannot reveal whether that is the right amount.", "raw", badTotal),
      frame("Conversion succeeds", "590.00 is a valid decimal of the expected type. The record can be parsed even though its business arithmetic conflicts.", "parse", badTotal),
      frame("The arithmetic conflicts", "3 × 199.50 = 598.50, not 590.00. The validator reports TOTAL_DOES_NOT_EQUAL_QUANTITY_TIMES_PRICE.", "validate", badTotal),
      frame("NEEDS_INFORMATION", "Keep 590.00 visible as the extracted candidate. Do not secretly replace it or use a format retry to force matching facts. One call was enough to find the conflict.", "result", badTotal)
    ],
    extra: [
      frame("Receive an extra field", "The output adds approved=true. That field is absent from this contract and cannot grant approval.", "raw", extra),
      frame("Strict conversion rejects it", "The custom mapper fails on the unknown property. The request may make one fresh format attempt using the original receipt and schema.", "parse", extra),
      frame("One bounded format retry", "This fixed case returns the same extra field again. It is a second scripted response, not a live model response.", "raw", extra, 2),
      frame("Conversion fails again", "The extra field is still rejected. The application does not ignore it to obtain a success.", "parse", extra, 2),
      frame("FAILED / FORMAT_ERROR", "The two-invocation ceiling is reached. Release no draft; offer manual entry or a separately budgeted action.", "result", extra, 2)
    ],
    repair: [
      frame("Receive incomplete JSON", "The object stops after the first property. This fixture supplies no known provider length-stop marker; conversion must fail.", "raw", malformed),
      frame("The text cannot be converted", "A format failure permits one fresh extraction. The request repeats the original source; it does not invent a date or echo arbitrary rejected output.", "parse", malformed),
      frame("Receive the second scripted output", "The next fixture response supplies the complete candidate. The page makes no actual extraction request.", "raw", good, 2),
      frame("Convert the second response", "One full object now fits the local record contract. This is format recovery, not proof of factual quality.", "parse", good, 2),
      frame("Check the candidate", "Amounts are consistent and the implemented source checks pass. Keep purchaseDate explicitly null.", "validate", good, 2),
      frame("READY_FOR_REVIEW after two calls", "The format attempt was recovered within the declared budget. A reviewer still compares the candidate with the receipt.", "result", good, 2)
    ],
    "wrong-facts": [
      frame("Receive plausible but wrong values", "This candidate says 1.00 each and 3.00 total. The displayed evidence quote still says 199.50 and 598.50.", "raw", wrongFacts),
      frame("The shape fits", "Both values are valid decimal numbers with the right keys. Syntax and type conversion do not prove source fidelity.", "parse", wrongFacts),
      frame("Local arithmetic also fits", "3 × 1.00 = 3.00. The exact quote occurs in the source, but the implemented substring check does not prove that the numeric fields agree with it.", "validate", wrongFacts),
      frame("READY_FOR_REVIEW is the limit", "A person must catch this source mismatch. The Java test deliberately demonstrates this boundary. Calling the candidate approved or verified would make an unsupported promise.", "result", wrongFacts)
    ]
  };
  let index = 0;
  function selected() { return scenarios[get("scenario").value]; }
  function render(rebuildTranscript = false) {
    const path = selected(), current = path[index];
    get("raw").textContent = current.raw;
    get("stage-title").textContent = current.title;
    get("note").textContent = current.note;
    get("calls").textContent = `In this illustrated path: ${current.calls} extraction request${current.calls === 1 ? "" : "s"}. This page makes none.`;
    Array.from(get("gates").children).forEach(item => {
      if (item.dataset.gate === current.gate) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
    get("prev").disabled = index === 0;
    get("next").disabled = index === path.length - 1;
    get("reset").disabled = false;
    get("status").textContent = `Step ${index + 1} of ${path.length}: ${current.title}.`;
    if (rebuildTranscript) {
      get("transcript").replaceChildren();
      path.forEach(current => {
        const item = document.createElement("li");
        item.textContent = `${current.title}. ${current.note} Illustrated requests so far: ${current.calls}.`;
        get("transcript").append(item);
      });
    }
  }
  get("scenario").disabled = false;
  get("scenario").addEventListener("change", () => { index = 0; render(true); });
  get("prev").addEventListener("click", () => { index = Math.max(0, index - 1); render(); });
  get("next").addEventListener("click", () => { index = Math.min(selected().length - 1, index + 1); render(); });
  get("reset").addEventListener("click", () => { index = 0; render(); });
  let theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  try { const saved = localStorage.getItem("kb-theme"); if (saved === "light" || saved === "dark") theme = saved; } catch (_) { }
  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    get("theme").textContent = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  }
  get("theme").addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("kb-theme", theme); } catch (_) { }
    applyTheme();
  });
  applyTheme();
  render(true);
})();
