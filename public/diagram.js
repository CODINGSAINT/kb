// Sketchy diagram renderer: {nodes, edges} JSON -> hand-drawn SVG via rough.js.
// Node: {id, label, x, y, w, h, shape: "rect"|"ellipse"|"diamond"|"cylinder"}
// Edge: {from, to, label?, dashed?}
(function () {
  const NS = "http://www.w3.org/2000/svg";

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return (h >>> 0) % 2 ** 31 || 1;
  }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // Point where the ray from the node centre toward (tx,ty) leaves the node.
  function clip(n, tx, ty) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    const pad = 6;
    if (n.shape === "ellipse") {
      const a = n.w / 2 + pad, b = n.h / 2 + pad;
      const t = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));
      return [cx + dx * t, cy + dy * t];
    }
    if (n.shape === "diamond") {
      const a = n.w / 2 + pad, b = n.h / 2 + pad;
      const t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
      return [cx + dx * t, cy + dy * t];
    }
    const hw = n.w / 2 + pad, hh = n.h / 2 + pad;
    const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    return [cx + dx * t, cy + dy * t];
  }

  function wrap(label, maxChars) {
    const words = String(label).split(/\s+/);
    const lines = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; }
      else cur = (cur + " " + w).trim();
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function text(svg, x, y, label, opts = {}) {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", x);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", opts.size || 15);
    t.setAttribute("fill", opts.color);
    if (opts.weight) t.setAttribute("font-weight", opts.weight);
    const lines = opts.maxChars ? wrap(label, opts.maxChars) : [String(label)];
    const lh = (opts.size || 15) * 1.2;
    const y0 = y - ((lines.length - 1) * lh) / 2;
    lines.forEach((ln, i) => {
      const s = document.createElementNS(NS, "tspan");
      s.setAttribute("x", x);
      s.setAttribute("y", y0 + i * lh);
      s.setAttribute("dominant-baseline", "central");
      s.textContent = ln;
      t.appendChild(s);
    });
    svg.appendChild(t);
    return t;
  }

  function render(container, spec, seedKey = "") {
    // Re-render once the handwriting font has loaded so label metrics are right.
    if (document.fonts && document.fonts.status !== "loaded" && !container._fontWait) {
      container._fontWait = true;
      document.fonts.load('16px "Kalam"').then(() => container.isConnected && render(container, spec, seedKey));
    }
    container.innerHTML = "";
    if (!spec || !Array.isArray(spec.nodes) || !spec.nodes.length) {
      container.innerHTML = '<p class="muted small">No diagram for this topic.</p>';
      return;
    }
    const ink = css("--ink"), paper = css("--paper"), soft = css("--text-soft"), bg = css("--bg-elev");
    const accents = [css("--accent"), css("--info"), css("--ok"), css("--lld")];
    const nodes = spec.nodes.map((n) => ({ w: 140, h: 50, shape: "rect", ...n }));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

    const pad = 30;
    const minX = Math.min(...nodes.map((n) => n.x)) - pad;
    const minY = Math.min(...nodes.map((n) => n.y)) - pad;
    const maxX = Math.max(...nodes.map((n) => n.x + n.w)) + pad;
    const maxY = Math.max(...nodes.map((n) => n.y + n.h)) + pad;

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Diagram: " + nodes.map((n) => n.label).join(", "));
    container.appendChild(svg);
    const rc = rough.svg(svg);

    // Edges first so nodes sit on top.
    (spec.edges || []).forEach((e, i) => {
      const a = byId[e.from], b = byId[e.to];
      if (!a || !b) return;
      const seed = hash(seedKey + "e" + i);
      const [x1, y1] = clip(a, b.x + b.w / 2, b.y + b.h / 2);
      const [x2, y2] = clip(b, a.x + a.w / 2, a.y + a.h / 2);
      const o = { stroke: ink, strokeWidth: 1.6, roughness: 1.3, bowing: 1.5, seed };
      if (e.dashed) o.strokeLineDash = [7, 6];
      svg.appendChild(rc.line(x1, y1, x2, y2, o));
      const ang = Math.atan2(y2 - y1, x2 - x1), len = 13, spread = 0.45;
      for (const s of [-spread, spread]) {
        svg.appendChild(rc.line(x2, y2, x2 - len * Math.cos(ang + s), y2 - len * Math.sin(ang + s), { ...o, strokeLineDash: undefined, roughness: 0.8 }));
      }
      if (e.label) {
        let mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const w = Math.max(30, String(e.label).length * 7.2 + 12);
        // Edge too short to hold its label inline: lift the label above the line.
        if (Math.hypot(x2 - x1, y2 - y1) < w + 24) {
          const nx = -(y2 - y1), ny = x2 - x1, nl = Math.hypot(nx, ny) || 1;
          const s = ny > 0 ? -1 : 1;
          mx += (s * nx / nl) * 20; my += (s * ny / nl) * 20;
        }
        const r = document.createElementNS(NS, "rect");
        Object.entries({ x: mx - w / 2, y: my - 11, width: w, height: 22, rx: 6, fill: bg, opacity: 0.92 }).forEach(([k, v]) => r.setAttribute(k, v));
        svg.appendChild(r);
        text(svg, mx, my, e.label, { size: 13, color: soft });
      }
    });

    nodes.forEach((n, i) => {
      const seed = hash(seedKey + n.id);
      const o = { stroke: ink, strokeWidth: 1.8, roughness: 1.4, fill: paper, fillStyle: "solid", seed };
      const accent = accents[i % accents.length];
      const hachure = { stroke: "none", fill: accent, fillStyle: "hachure", hachureGap: 7, fillWeight: 0.9, roughness: 1.6, seed: seed + 1 };
      const { x, y, w, h } = n;
      if (n.shape === "ellipse") {
        svg.appendChild(rc.ellipse(x + w / 2, y + h / 2, w, h, o));
        svg.appendChild(rc.ellipse(x + w / 2, y + h / 2, w, h, { ...hachure, fill: accent + "55" }));
      } else if (n.shape === "diamond") {
        const pts = [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]];
        svg.appendChild(rc.polygon(pts, o));
      } else if (n.shape === "cylinder") {
        const ry = Math.min(10, h / 5);
        svg.appendChild(rc.rectangle(x, y + ry, w, h - 2 * ry, { ...o, stroke: "none" }));
        svg.appendChild(rc.line(x, y + ry, x, y + h - ry, o));
        svg.appendChild(rc.line(x + w, y + ry, x + w, y + h - ry, o));
        svg.appendChild(rc.ellipse(x + w / 2, y + h - ry, w, 2 * ry, o));
        svg.appendChild(rc.ellipse(x + w / 2, y + ry, w, 2 * ry, o));
      } else {
        svg.appendChild(rc.rectangle(x, y, w, h, o));
        svg.appendChild(rc.rectangle(x + 3, y + h - 9, w - 6, 6, { ...hachure, fill: accent + "88" }));
      }
      const maxChars = Math.max(6, Math.floor(w / 8.5));
      text(svg, x + w / 2, y + h / 2 - (n.shape === "rect" ? 2 : 0), n.label, { size: 16, weight: 700, color: ink, maxChars });
    });
  }

  window.KBDiagram = { render };
})();
