const SIZES = {
  phone: { w: 390, h: 844, label: "phone" },
  tablet: { w: 834, h: 1194, label: "tablet" },
  desktop: { w: 1440, h: 900, label: "desktop" }
};
const GAP = 80, HEAD = 360, ROW_GAP = 520, MIN_Z = 0.03, MAX_Z = 4;
const STORE = `mockup-board:${location.pathname}`;

const viewportEl = document.getElementById("viewport");
const world = document.getElementById("world");
const zoomButton = document.getElementById("zoom");
const cam = { x: 0, y: 0, z: 1 };
const frames = [];
const titles = [];
let topZ = 1, selected = null, live = null, drag = null, space = false;

function el(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids.flat(Infinity).filter(k => k != null && k !== false && k !== ""));
  return node;
}
const sizeOf = s => typeof s === "string" ? SIZES[s] || SIZES.desktop : { label: `${s.w}x${s.h}`, ...s };
const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
const saved = Object.assign({ frames: {}, titles: {} }, load());
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch {} };

function applyCamera() {
  world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
  world.style.setProperty("--z", cam.z);
  const cell = 40 * cam.z * 2 ** -Math.floor(Math.log2(cam.z));
  viewportEl.style.backgroundSize = `${cell}px ${cell}px`;
  viewportEl.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
  zoomButton.textContent = `${Math.round(cam.z * 100)}%`;
  for (const f of frames) f.node.classList.toggle("narrow", f.w * cam.z < 260);
  for (const f of frames) f.node.classList.toggle("narrow", f.w * cam.z < 260);
  saved.camera = { ...cam };
  save();
}
function zoomTo(px, py, z) {
  z = Math.min(MAX_Z, Math.max(MIN_Z, z));
  cam.x = px - (px - cam.x) * (z / cam.z);
  cam.y = py - (py - cam.y) * (z / cam.z);
  cam.z = z;
  applyCamera();
}
function fit(items) {
  if (!items.length) return;
  const x1 = Math.min(...items.map(i => i.x)), y1 = Math.min(...items.map(i => i.y - (i.frame ? 40 : 0)));
  const x2 = Math.max(...items.map(i => i.x + i.w)), y2 = Math.max(...items.map(i => i.y + i.h + (i.frame ? 60 : 0)));
  const z = Math.min(MAX_Z, Math.max(MIN_Z, Math.min((innerWidth - 96) / (x2 - x1), (innerHeight - 150) / (y2 - y1), 1)));
  cam.z = z;
  cam.x = (innerWidth - (x2 - x1) * z) / 2 - x1 * z;
  cam.y = 60 + (innerHeight - 100 - (y2 - y1) * z) / 2 - y1 * z;
  applyCamera();
}
const fitAll = () => fit([...frames, ...titles]);

function place(item) {
  item.node.style.left = `${item.x}px`;
  item.node.style.top = `${item.y}px`;
}

function select(frame) {
  selected?.node.classList.remove("selected");
  selected = frame;
  if (frame) frame.node.style.zIndex = ++topZ;
  frame?.node.classList.add("selected");
}
function mount(frame) {
  const view = el("iframe", { src: frame.src, title: frame.name, className: "view" });
  Object.assign(view.style, { width: `${frame.w}px`, height: `${frame.h}px` });
  const old = frame.node.querySelector(".view");
  if (!old) return frame.node.querySelector(".strip").after(view);
  view.classList.add("loading");
  view.onload = () => { old.remove(); view.classList.remove("loading"); };
  old.after(view);
}
function resize(frame) {
  frame.node.querySelector(".view").style.width = `${frame.w}px`;
  frame.node.querySelector(".view").style.height = `${frame.h}px`;
  const label = frame.node.querySelector(".strip span");
  label.textContent = label.title = `${frame.base} · ${frame.w}×${frame.h}`;
}
function leave() {
  if (!live) return;
  live.node.classList.remove("live");
  document.activeElement?.blur();
  live = null;
}
function enter(frame) {
  if (live === frame) return;
  leave();
  live = frame;
  select(frame);
  frame.node.classList.add("live");
  mount(frame);
}

const history = { done: [], undone: [] };
const positions = () => [...titles, ...frames].map(m => ({ m, x: m.x, y: m.y, w: m.w, h: m.h }));
function persist(m) {
  if (m.frame) saved.frames[m.key] = { x: m.x, y: m.y, w: m.w, h: m.h };
  else saved.titles[m.slug] = { x: m.x, y: m.y };
}
function restore(snapshot) {
  for (const { m, x, y, w, h } of snapshot) {
    Object.assign(m, { x, y, w, h });
    place(m);
    if (m.frame) resize(m);
    persist(m);
  }
  save();
}
function record(before) {
  history.done.push({ before, after: positions() });
  history.undone = [];
}
function undo() {
  const step = history.done.pop();
  if (!step) return;
  restore(step.before);
  history.undone.push(step);
}
function redo() {
  const step = history.undone.pop();
  if (!step) return;
  restore(step.after);
  history.done.push(step);
}

function layout() {
  let y = 0;
  for (const entry of BOARD) {
    const title = titles.find(t => t.slug === entry.slug);
    const own = frames.filter(f => f.slug === entry.slug);
    Object.assign(title, saved.titles[entry.slug] || { x: 0, y });
    let x = 0;
    for (const f of own) {
      Object.assign(f, { w: f.declared.w, h: f.declared.h }, saved.frames[f.key] || { x, y: y + HEAD });
      resize(f);
      x += f.w + GAP;
    }
    y += HEAD + Math.max(0, ...own.map(f => f.h)) + ROW_GAP;
  }
  [...titles, ...frames].forEach(place);
}

function build() {
  for (const entry of BOARD) {
    const title = { slug: entry.slug };
    title.node = el("div", { className: "title", id: entry.slug },
      el("h2", { textContent: entry.title || entry.slug }),
      entry.question && el("p", { textContent: entry.question }));
    title.node.dataset.slug = entry.slug;
    titles.push(title);
    world.append(title.node);
    (entry.frames || []).forEach((frame, i) => {
      const size = sizeOf(frame.size || "desktop");
      const src = `${entry.slug}/${frame.file}`;
      const base = [frame.id, frame.title || frame.file].filter(Boolean).join(" · ");
      const item = { frame: true, slug: entry.slug, key: `${src}@${size.w}x${size.h}#${i}`, src, name: base, base, w: size.w, h: size.h, declared: { w: size.w, h: size.h } };
      item.node = el("div", { className: "frame", id: `${entry.slug}/${frame.file}` },
        el("div", { className: "strip" },
          el("span"),
          el("a", { href: src, target: "_blank", textContent: "↗", title: "Open the page alone" })),
        frame.note && el("p", { className: "caption", textContent: frame.note }),
        ["nw", "ne", "sw", "se"].map(corner => {
          const handle = el("div", { className: `resize ${corner}`, title: "Drag to resize the page" });
          handle.dataset.corner = corner;
          return handle;
        }));
      item.node.title = "Double-click to use the page; click outside it to return to the board";
      item.node.frameItem = item;
      mount(item);
      frames.push(item);
      world.append(item.node);
    });
  }
  titles.forEach(t => { t.w = t.node.offsetWidth; t.h = t.node.offsetHeight; });
  layout();
}

viewportEl.addEventListener("pointerdown", e => {
  const wheel = e.button === 1;
  if (wheel) e.preventDefault();
  else if (e.button !== 0 || e.target.closest("button, a")) return;
  const frameNode = e.target.closest(".frame");
  const titleNode = e.target.closest(".title");
  const handle = e.target.closest(".resize");
  if (!wheel && !space && handle) {
    const frame = frameNode.frameItem;
    leave();
    select(frame);
    drag = { sx: e.clientX, sy: e.clientY, moved: false, moving: [], sizing: frame, corner: handle.dataset.corner, before: positions(), from: { x: frame.x, y: frame.y, w: frame.w, h: frame.h }, cam: { ...cam } };
    viewportEl.setPointerCapture(e.pointerId);
    return;
  }
  let moving = [];
  if (wheel) moving = [];
  else if (!space && e.target.closest(".strip")) { leave(); select(frameNode.frameItem); moving = [frameNode.frameItem]; }
  else if (!space && titleNode) {
    const title = titles.find(t => t.slug === titleNode.dataset.slug);
    leave();
    select(title);
    moving = [title];
  }
  else if (!space && frameNode && selected === frameNode.frameItem) moving = [frameNode.frameItem];
  else if (!space && frameNode) { leave(); drag = { sx: e.clientX, sy: e.clientY, moved: false, moving: [], pick: frameNode.frameItem, cam: { ...cam } }; viewportEl.setPointerCapture(e.pointerId); return; }
  drag = { sx: e.clientX, sy: e.clientY, moved: false, moving, before: positions(), from: moving.map(m => ({ x: m.x, y: m.y })), cam: { ...cam } };
  viewportEl.setPointerCapture(e.pointerId);
});
viewportEl.addEventListener("pointermove", e => {
  if (!drag) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) < 3) return;
  if (!drag.moved) { drag.moved = true; document.body.classList.add("dragging"); }
  if (drag.sizing) {
    const { from, corner, sizing } = drag;
    sizing.w = Math.max(120, Math.round(from.w + (corner.includes("w") ? -dx : dx) / cam.z));
    sizing.h = Math.max(80, Math.round(from.h + (corner.includes("n") ? -dy : dy) / cam.z));
    sizing.x = corner.includes("w") ? from.x + from.w - sizing.w : from.x;
    sizing.y = corner.includes("n") ? from.y + from.h - sizing.h : from.y;
    place(sizing);
    resize(sizing);
  } else if (drag.moving.length) {
    drag.moving.forEach((m, i) => { m.x = drag.from[i].x + dx / cam.z; m.y = drag.from[i].y + dy / cam.z; place(m); });
  } else {
    cam.x = drag.cam.x + dx;
    cam.y = drag.cam.y + dy;
    applyCamera();
  }
});
viewportEl.addEventListener("pointerup", () => {
  if (!drag) return;
  document.body.classList.remove("dragging");
  if (drag.moved && (drag.moving.length || drag.sizing)) {
    (drag.sizing ? [drag.sizing] : drag.moving).forEach(persist);
    save();
    record(drag.before);
  }
  if (!drag.moved && drag.pick) select(drag.pick);
  else if (!drag.moved && !drag.moving.length && !drag.sizing) { select(null); leave(); }
  drag = null;
});
viewportEl.addEventListener("dblclick", e => {
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const frameNode = under?.closest(".frame");
  if (frameNode && !under.closest(".resize, a")) enter(frameNode.frameItem);
});
viewportEl.addEventListener("mousedown", e => (e.button === 1 || !e.target.closest("button, a")) && e.preventDefault());
viewportEl.addEventListener("wheel", e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomTo(e.clientX, e.clientY, cam.z * Math.exp(-Math.max(-10, Math.min(10, e.deltaY)) * 0.02));
  else { cam.x -= e.deltaX; cam.y -= e.deltaY; applyCamera(); }
}, { passive: false });
let gestureZ = 1;
addEventListener("gesturestart", e => { e.preventDefault(); gestureZ = cam.z; });
addEventListener("gesturechange", e => { e.preventDefault(); zoomTo(e.clientX, e.clientY, gestureZ * e.scale); });

const zoomCenter = factor => zoomTo(innerWidth / 2, innerHeight / 2, factor ? cam.z * factor : 1);
addEventListener("keydown", e => {
  const mod = e.metaKey || e.ctrlKey;
  if (e.code === "Space" && !space) { space = true; document.body.classList.add("space"); e.preventDefault(); }
  else if (e.key === "Escape") live ? leave() : select(null);
  else if (e.shiftKey && e.code === "Digit1") fitAll();
  else if (e.shiftKey && e.code === "Digit2" && selected) fit([selected]);
  else if (mod && e.code === "KeyZ") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && e.code === "KeyY") { e.preventDefault(); redo(); }
  else if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomCenter(1.25); }
  else if (mod && e.key === "-") { e.preventDefault(); zoomCenter(0.8); }
  else if (mod && e.key === "0") { e.preventDefault(); zoomCenter(); }
});
addEventListener("keyup", e => { if (e.code === "Space") { space = false; document.body.classList.remove("space"); } });

zoomButton.onclick = fitAll;
document.getElementById("zoom-in").onclick = () => zoomCenter(1.25);
document.getElementById("zoom-out").onclick = () => zoomCenter(0.8);
document.getElementById("reset").onclick = () => {
  const before = positions();
  saved.frames = {};
  saved.titles = {};
  save();
  layout();
  record(before);
  fitAll();
};

if (!BOARD.length) document.body.append(el("p", { id: "empty", textContent: "board.js adds nothing yet." }));
build();
const target = decodeURIComponent(location.hash.slice(1));
const hit = frames.filter(f => f.node.id === target || f.slug === target);
if (hit.length) fit(hit.length > 1 ? [...hit, ...titles.filter(t => t.slug === target)] : hit);
else if (saved.camera) { Object.assign(cam, saved.camera); applyCamera(); }
else fitAll();
