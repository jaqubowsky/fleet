() => {
  const findings = [];
  const vw = document.documentElement.clientWidth;
  const name = node => {
    const path = [];
    for (let n = node; n && n.nodeType === 1 && path.length < 4; n = n.parentElement) {
      const cls = [...n.classList].slice(0, 2).map(c => `.${c}`).join("");
      path.unshift(n.id ? `${n.localName}#${n.id}` : `${n.localName}${cls}`);
      if (n.id) break;
    }
    return path.join(" > ");
  };
  const text = node => (node.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40);
  const visible = node => {
    const s = getComputedStyle(node);
    const r = node.getBoundingClientRect();
    return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
  };
  const outside = node => {
    const r = node.getBoundingClientRect();
    return getComputedStyle(node).position !== "fixed" && (r.right > vw + 1 || r.left < -1);
  };
  const scrolls = node => {
    for (let n = node.parentElement; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/auto|scroll/.test(s.overflowX)) return true;
    }
    return false;
  };

  if (document.documentElement.scrollWidth > vw + 1) {
    findings.push({ kind: "page-overflow", where: "document", detail: `scrollWidth ${document.documentElement.scrollWidth} > viewport ${vw}` });
  }

  for (const node of document.body.querySelectorAll("*")) {
    if (!visible(node)) continue;
    const s = getComputedStyle(node);
    const r = node.getBoundingClientRect();

    const clipsX = /hidden|clip/.test(s.overflowX) && node.scrollWidth > node.clientWidth + 1;
    const clipsY = /hidden|clip/.test(s.overflowY) && node.scrollHeight > node.clientHeight + 1;
    if ((clipsX || clipsY) && text(node) && !node.closest("[data-clip]")) {
      findings.push({ kind: "clipped", where: name(node), detail: `"${text(node)}" content ${node.scrollWidth}×${node.scrollHeight} in box ${node.clientWidth}×${node.clientHeight}` });
    }

    if (outside(node) && !(node.parentElement !== document.body && outside(node.parentElement)) && !scrolls(node)) {
      findings.push({ kind: "off-viewport", where: name(node), detail: `spans ${Math.round(r.left)}..${Math.round(r.right)} in viewport ${vw}` });
    }

    const label = [...node.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join("").trim();
    if (label && label.length <= 40 && !node.closest("h1, h2, h3, h4, h5, h6, p, pre, code") && node.children.length === 0) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const lines = new Set([...range.getClientRects()].filter(q => q.width > 0).map(q => Math.round(q.top)));
      if (lines.size > 1) findings.push({ kind: "wrapped-label", where: name(node), detail: `"${label}" on ${lines.size} lines` });
    }
  }

  const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgba = color => {
    pixel.clearRect(0, 0, 1, 1);
    pixel.fillStyle = color;
    pixel.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = pixel.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = ([r, g, b, a], [br, bg, bb]) => [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
  const backdrop = node => {
    const layers = [];
    for (let n = node; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage !== "none") return null;
      const layer = rgba(s.backgroundColor);
      if (layer[3] > 0) layers.push(layer);
      if (layer[3] === 1) break;
    }
    return layers.reduceRight((under, layer) => over(layer, under), [255, 255, 255]);
  };
  const luminance = rgb => {
    const [r, g, b] = rgb.map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const overlay = node => {
    for (let n = node; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/absolute|fixed/.test(s.position) && s.zIndex !== "auto") return n;
    }
    return null;
  };
  const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system|BlinkMacSystemFont|Segoe UI|Helvetica( Neue)?|Arial|Roboto|emoji|math)$/i;
  const loadedFamilies = new Set([...document.fonts].filter(f => f.status === "loaded").map(f => f.family.replace(/["']/g, "")));
  const missingFonts = new Map();
  const texts = [];

  for (const node of document.body.querySelectorAll("*")) {
    if (!visible(node) || ![...node.childNodes].some(c => c.nodeType === 3 && c.textContent.trim())) continue;
    const s = getComputedStyle(node);
    const own = node.getBoundingClientRect();
    if (own.width <= 1 || own.height <= 1 || s.clip !== "auto" || s.clipPath !== "none") continue;

    const family = s.fontFamily.split(",")[0].trim().replace(/["']/g, "");
    if (!GENERIC.test(family) && !loadedFamilies.has(family)) missingFonts.set(family, name(node));

    const range = document.createRange();
    range.selectNodeContents(node);
    const box = range.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) texts.push({ node, box, layer: overlay(node) });

    if (node.closest(":disabled, [aria-disabled='true']")) continue;
    const under = backdrop(node);
    if (!under) continue;
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const contrast = ratio(luminance(over(rgba(s.color), under)), luminance(under));
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    if (contrast < (large ? 3 : 4.5)) {
      findings.push({ kind: "low-contrast", where: name(node), detail: `"${text(node)}" ${contrast.toFixed(2)}:1, needs ${large ? 3 : 4.5}:1` });
    }
  }

  for (const [family, where] of missingFonts) {
    findings.push({ kind: "font-fallback", where, detail: `"${family}" never loaded; text renders in the next font of the stack` });
  }

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (a.layer !== b.layer || a.node.contains(b.node) || b.node.contains(a.node)) continue;
      const w = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
      const h = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (w > 2 && h > 2) findings.push({ kind: "overlap", where: name(a.node), detail: `"${text(a.node)}" overlaps "${text(b.node)}" at ${name(b.node)}` });
    }
  }

  const unique =[...new Map(findings.map(f => [`${f.kind}|${f.where}|${f.detail}`, f])).values()];
  return { viewport: `${vw}×${document.documentElement.clientHeight}`, count: unique.length, findings: unique };
}
