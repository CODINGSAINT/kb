// Diagram renderer: {nodes, edges} JSON -> clean SVG (rounded boxes, datastores, labelled arrows).
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
    // Re-render once the UI font has loaded so label metrics are right.
    if (document.fonts && document.fonts.status !== "loaded" && !container._fontWait) {
      container._fontWait = true;
      document.fonts.load('16px "Inter Variable"').then(() => container.isConnected && render(container, spec, seedKey));
    }
    container.innerHTML = "";
    if (!spec || !Array.isArray(spec.nodes) || !spec.nodes.length) {
      container.innerHTML = '<p class="muted small">No diagram for this topic.</p>';
      return;
    }
    const ink = css("--ink"), paper = css("--paper"), soft = css("--text-soft"), bg = css("--bg-elev");
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
    // Clean, flat style: rounded boxes in pale Persian blue, datastores in pale cyan,
    // thin slate connectors with solid arrowheads.
    const accent = css("--accent"), accentSoft = css("--accent-soft"), sub = css("--sub"), subSoft = css("--sub-soft"), text_ = css("--text");
    const el = (tag, attrs, parent = svg) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      parent.appendChild(e);
      return e;
    };
    const defs = el("defs", {});
    const markerId = "kb-arrow-" + Math.abs(hash(seedKey + "m"));
    const m = el("marker", { id: markerId, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
    el("path", { d: "M0,0 L10,5 L0,10 z", fill: soft }, m);

    // Edges first so nodes sit on top.
    (spec.edges || []).forEach((e) => {
      const a = byId[e.from], b = byId[e.to];
      if (!a || !b) return;
      const [x1, y1] = clip(a, b.x + b.w / 2, b.y + b.h / 2);
      const [x2, y2] = clip(b, a.x + a.w / 2, a.y + a.h / 2);
      const ln = el("line", { x1, y1, x2, y2, stroke: soft, "stroke-width": 1.6, "marker-end": `url(#${markerId})`, "stroke-linecap": "round" });
      if (e.dashed) ln.setAttribute("stroke-dasharray", "6 5");
      if (e.label) {
        let mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const w = Math.max(30, String(e.label).length * 6.6 + 14);
        // Edge too short to hold its label inline: lift the label above the line.
        if (Math.hypot(x2 - x1, y2 - y1) < w + 24) {
          const nx = -(y2 - y1), ny = x2 - x1, nl = Math.hypot(nx, ny) || 1;
          const sgn = ny > 0 ? -1 : 1;
          mx += (sgn * nx / nl) * 20; my += (sgn * ny / nl) * 20;
        }
        el("rect", { x: mx - w / 2, y: my - 11, width: w, height: 22, rx: 11, fill: bg, stroke: css("--border"), "stroke-width": 1 });
        text(svg, mx, my, e.label, { size: 12, color: soft, weight: 500 });
      }
    });

    nodes.forEach((n) => {
      const { x, y, w, h } = n;
      const store = n.shape === "cylinder";
      const stroke = store ? sub : accent, fill = store ? subSoft : accentSoft;
      const o = { fill, stroke, "stroke-width": 1.6 };
      if (n.shape === "ellipse") {
        el("ellipse", { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...o });
      } else if (n.shape === "diamond") {
        el("polygon", { points: `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`, ...o });
      } else if (store) {
        const ry = Math.min(9, h / 5);
        el("path", { d: `M${x},${y + ry} L${x},${y + h - ry} A${w / 2},${ry} 0 0 0 ${x + w},${y + h - ry} L${x + w},${y + ry}`, ...o });
        el("ellipse", { cx: x + w / 2, cy: y + ry, rx: w / 2, ry, ...o });
      } else {
        el("rect", { x, y, width: w, height: h, rx: 10, ...o });
      }
      const maxChars = Math.max(6, Math.floor(w / 8));
      text(svg, x + w / 2, y + h / 2 + (store ? 4 : 0), n.label, { size: 14.5, weight: 650, color: store ? sub : text_, maxChars });
    });
  }

  window.KBDiagram = { render };
})();
