import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, terminals, layout, exec, readTextFile, settings, theme } from "herdr";

const FLEET = ["-ic", 'fleet "$@"', "zsh"];
const VIEW = "changes";
const REFRESH_MS = 3000;
const LARGE = 400;
const MAX_LINES = 5000;
const MAX_LINE = 4000;
const TREE_W = 240;
const TREE_FROM = 640;
const CHAR_W = 7.4;
const SYNTAX = { keyword: "ansi5", string: "ansi2", comment: "dim", function: "ansi4", type: "ansi3", number: "ansi1" };
const KEYWORDS = new Set(
  "as async await break case catch class const continue def default delete do elif else enum export extends false finally fn for from func function if impl import in instanceof interface let match new nil none not null of or package private protected pub public readonly return self static struct super switch this throw true try type typeof undefined use var void while with yield add and alter begin by commit constraint create drop foreign group index insert into join key on order primary references select set table unique update values where".split(" "),
);
const HASH = /\.(py|sh|bash|zsh|ya?ml|toml|nix|rb|conf|ini|env|r|pl)$|(^|\/)(Dockerfile|Makefile|\.gitignore)$/;
const DASH = /\.sql$/;
const PLAIN = /\.(md|mdx|txt|rst|csv|log)$/;
const SIZE = { head: 36, hunk: 24, line: 20, note: 36, end: 6, gap: 10 };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const visible = () => find(layout(), "work-view")?.active === VIEW;

function place() {
  const space = spaces().find((s) => s.active);
  const tab = space?.tabs.find((t) => t.active);
  const mine = panes().filter((p) => p.tab === tab?.id && p.terminal);
  const shown = new Set(mine.map((p) => p.terminal));
  const sandbox = terminals().find((t) => shown.has(t.address) && t.labels?.["fleet.sandbox"])?.labels["fleet.sandbox"];
  if (sandbox) return { key: `fleet:${sandbox}`, sandbox };
  const cwd = (mine.find((p) => p.program?.agent) ?? mine[0])?.cwd ?? space?.folder;
  return cwd ? { key: JSON.stringify([space?.machine ?? null, cwd]), cwd, on: space?.machine ?? undefined } : null;
}

const fleet = (args) => exec("zsh", [...FLEET, ...args]);
const lastLine = (text) => text.trim().split("\n").pop() ?? "";
const side = (line) => line?.slice(4).replace(/^[ab]\//, "").replace(/\t$/, "");
const clip = (line) => (line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}… (line cut)` : line);
const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
const nameOf = (p) => p.split("/").pop();

function stanzas(patch) {
  return patch
    .split(/^(?=diff --git )/m)
    .filter((s) => s.startsWith("diff --git "))
    .map((stanza) => {
      const lines = stanza.replace(/\n$/, "").split("\n");
      const before = lines.find((l) => l.startsWith("--- "));
      const after = lines.find((l) => l.startsWith("+++ "));
      const fresh = before === "--- /dev/null" || lines.some((l) => l.startsWith("new file mode"));
      const gone = after === "+++ /dev/null" || lines.some((l) => l.startsWith("deleted file mode"));
      const path = (!gone && side(after)) || (!fresh && side(before)) || lines[0].replace(/^diff --git a\/(.*) b\/.*$/, "$1");
      const start = lines.findIndex((l) => l.startsWith("@@"));
      const body = start < 0 ? [] : lines.slice(start);
      return {
        path,
        fresh,
        gone,
        binary: lines.some((l) => l.startsWith("Binary files")),
        add: body.filter((l) => l.startsWith("+")).length,
        del: body.filter((l) => l.startsWith("-")).length,
        lines: body,
      };
    });
}

function numbered(lines) {
  let old = 0;
  let next = 0;
  return lines.slice(0, MAX_LINES).map((line) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (hunk) {
      old = +hunk[1];
      next = +hunk[2];
      return { kind: "hunk", text: line };
    }
    const sign = line[0];
    if (sign === "+") return { kind: "line", sign, new: next++, text: clip(line.slice(1)) };
    if (sign === "-") return { kind: "line", sign, old: old++, text: clip(line.slice(1)) };
    if (sign === " ") return { kind: "line", sign, old: old++, new: next++, text: clip(line.slice(1)) };
    return { kind: "line", sign: "", text: clip(line) };
  });
}

function tokens(text, path) {
  if (PLAIN.test(path)) return [{ text }];
  const comment = HASH.test(path) ? "#.*" : DASH.test(path) ? "--.*" : "\\/\\/.*|\\/\\*.*?(?:\\*\\/|$)";
  const pattern = new RegExp(`(${comment})|("(?:[^"\\\\]|\\\\.)*"?|'(?:[^'\\\\]|\\\\.)*'?|\`(?:[^\`\\\\]|\\\\.)*\`?)|(\\b\\d[\\w.]*)|([A-Za-z_$][\\w$]*)(?=\\s*\\()|([A-Za-z_$][\\w$]*)`, "g");
  const out = [];
  let at = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    const word = m[5];
    const kind = m[1] ? "comment" : m[2] ? "string" : m[3] ? "number" : m[4] ? (KEYWORDS.has(m[4]) ? "keyword" : "function")
      : KEYWORDS.has(word) || (word === word.toUpperCase() && KEYWORDS.has(word.toLowerCase())) ? "keyword" : /^[A-Z][a-z]/.test(word) ? "type" : null;
    out.push({ text: m[0], kind });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

function slice(spans, from, to) {
  const out = [];
  let at = 0;
  for (const s of spans) {
    const end = at + s.text.length;
    if (end > from && at < to) out.push({ ...s, text: s.text.slice(Math.max(0, from - at), to - at) });
    at = end;
  }
  return out;
}

function tree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    let node = root;
    for (const part of f.path.split("/").slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push(f);
  }
  const flat = [];
  const walk = (node, depth, at) => {
    for (const [name, dir] of [...node.dirs].sort(([a], [b]) => a.localeCompare(b))) {
      let label = name;
      let inner = dir;
      while (inner.dirs.size === 1 && inner.files.length === 0) {
        const [[more, deeper]] = inner.dirs;
        label += `/${more}`;
        inner = deeper;
      }
      const path = `${at}${label}/`;
      flat.push({ kind: "dir", path, label, depth });
      walk(inner, depth + 1, path);
    }
    for (const f of node.files) flat.push({ kind: "file", path: f.path, label: nameOf(f.path), depth, file: f });
  };
  walk(root, 0, "");
  return flat;
}

export default class FleetChanges extends View {
  init(_props, cx) {
    this.key = null;
    this.title = "";
    this.files = [];
    this.open = new Map();
    this.shown = new Set();
    this.closedDirs = new Set();
    this.untracked = new Map();
    this.current = null;
    this.query = "";
    this.error = null;
    this.rows = [];
    this.width = 600;
    this.whole = 0;
    this.height = 600;
    this.scroll = VirtualListScrollHandle.new();
    this.filter = InputState.new({ placeholder: "Filter files…" });
    this.filter.on("change", (_e, cx) => {
      this.query = this.filter.value().trim().toLowerCase();
      this.build();
      cx.notify();
    });
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    const where = place();
    if (!where || this.busy || !visible()) return;
    this.busy = true;
    if (where.key !== this.key) {
      this.key = where.key;
      this.title = "";
      this.files = [];
      this.open = new Map();
      this.shown = new Set();
      this.closedDirs = new Set();
      this.untracked = new Map();
      this.current = null;
      this.error = null;
      this.build();
    }
    cx.spawn(async (cx) => {
      try {
        const files = where.sandbox ? await this.containerChanges(where) : await this.folderChanges(where);
        if (place()?.key !== where.key) return;
        this.files = files;
        this.error = null;
      } catch (error) {
        this.files = [];
        this.error = String(error.message ?? error);
      } finally {
        this.busy = false;
        this.build();
        cx.notify();
      }
    });
  }

  async containerChanges(where) {
    const r = await fleet(["patch", where.sandbox]);
    if (r.code !== 0) throw new Error(lastLine(r.stderr || r.stdout));
    this.title = where.sandbox;
    return stanzas(r.stdout);
  }

  async folderChanges(where) {
    const { cwd, on } = where;
    const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
    if (top.code !== 0) throw new Error("This tab's folder is not in a git repository.");
    const root = top.stdout.trim();
    this.title = nameOf(root);
    const diff = await exec("git", ["diff", "HEAD", "--no-color", "--no-ext-diff", "--no-renames"], { cwd: root, on });
    const files = stanzas(diff.stdout);
    const untracked = await exec("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, on });
    for (const path of untracked.stdout.split("\n").filter(Boolean))
      files.push(this.untracked.get(path) ?? { path, fresh: true, gone: false, binary: false, add: 0, del: 0, lines: null, root, on });
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  load(file, cx) {
    cx.spawn(async (cx) => {
      const text = (await readTextFile(`${file.root}/${file.path}`, { on: file.on }).catch(() => null)) ?? "";
      const body = text.replace(/\n$/, "").split("\n");
      const loaded = text.includes("\0")
        ? { ...file, binary: true, lines: [] }
        : { ...file, add: body.length, lines: [`@@ -0,0 +1,${body.length} @@`, ...body.map((l) => `+${l}`)] };
      this.untracked.set(file.path, loaded);
      this.files = this.files.map((f) => (f.path === file.path ? loaded : f));
      this.build();
      cx.notify();
    });
  }

  isOpen(f) {
    return this.open.get(f.path) ?? !(f.gone || f.lines === null);
  }

  matches(f) {
    return !this.query || f.path.toLowerCase().includes(this.query);
  }

  build() {
    const rows = [];
    this.heads = new Map();
    for (const f of this.files.filter((f) => this.matches(f))) {
      if (rows.length) rows.push({ kind: "gap", key: `g:${f.path}` });
      this.heads.set(f.path, rows.length);
      const open = this.isOpen(f);
      rows.push({ kind: "head", key: `h:${f.path}`, file: f, open });
      if (!open) continue;
      if (f.lines === null) rows.push({ kind: "note", key: `x:${f.path}`, file: f, text: "New file. Click to show its contents.", action: true });
      else if (f.binary) rows.push({ kind: "note", key: `n:${f.path}`, file: f, text: "Binary file not shown." });
      else if (f.lines.length > LARGE && !this.shown.has(f.path))
        rows.push({ kind: "note", key: `x:${f.path}`, file: f, text: `Large diff, ${f.lines.length} lines. Click to show it.`, action: true });
      else if (!f.lines.length) rows.push({ kind: "note", key: `n:${f.path}`, file: f, text: f.gone ? "Empty file deleted." : "No text change." });
      else {
        const lines = numbered(f.lines);
        const digits = String(Math.max(1, ...lines.map((l) => Math.max(l.old ?? 0, l.new ?? 0)))).length;
        const cols = Math.max(20, Math.floor((this.width - 24 - 2 * this.gutter(digits) - 30) / CHAR_W));
        lines.forEach((l, i) => {
          if (l.kind === "hunk") return rows.push({ ...l, key: `l:${f.path}:${i}`, file: f, digits });
          const spans = tokens(l.text, f.path);
          for (let at = 0, part = 0; at === 0 || at < l.text.length; at += cols, part++) {
            const piece = { text: l.text.slice(at, at + cols), spans: slice(spans, at, at + cols), key: `l:${f.path}:${i}:${part}`, file: f, digits };
            rows.push(part ? { kind: "line", sign: l.sign, more: true, ...piece } : { ...l, ...piece });
          }
        });
        if (f.lines.length > MAX_LINES)
          rows.push({ kind: "note", key: `m:${f.path}`, file: f, text: `${f.lines.length - MAX_LINES} more lines not shown.` });
      }
      rows.push({ kind: "end", key: `e:${f.path}` });
    }
    this.rows = rows;
  }

  gutter(digits) {
    return digits * 7.3 + 16;
  }

  resized(width, cx) {
    if (Math.abs(width - this.width) < 1) return;
    this.width = width;
    this.build();
    cx.notify();
  }

  toggle(path, cx) {
    const f = this.files.find((f) => f.path === path);
    if (!f) return;
    this.open.set(path, !this.isOpen(f));
    this.build();
    cx.notify();
  }

  reveal(path, cx) {
    const f = this.files.find((f) => f.path === path);
    if (!f) return;
    if (f.lines === null) this.load(f, cx);
    else this.shown.add(path);
    this.build();
    cx.notify();
  }

  jump(path, cx) {
    this.current = path;
    this.open.set(path, true);
    this.build();
    const at = this.heads.get(path);
    if (at === undefined) return cx.notify();
    let below = at;
    for (let room = this.height; below < this.rows.length - 1 && room > SIZE[this.rows[below].kind]; below++) room -= SIZE[this.rows[below].kind];
    this.scroll.scroll_to_item(below, "top");
    cx.timer.after(60, (cx) => {
      this.scroll.scroll_to_item(at, "top");
      cx.notify();
    });
    cx.notify();
  }

  clicked(key, cx) {
    const path = key.slice(2);
    if (key.startsWith("h:")) this.toggle(path, cx);
    else if (key.startsWith("x:")) this.reveal(path, cx);
  }

  card(t, el) {
    return el.mx(12).border_l(1).border_r(1).border_color(t.border);
  }

  head(t, { file: f, open }) {
    const total = f.add + f.del;
    const green = total ? Math.round((5 * f.add) / total) : 0;
    const red = total ? Math.max(f.del ? 1 : 0, 5 - green) : 0;
    const blocks = [...Array(5)].map((_, i) =>
      div().size(7).rounded(2).bg(i < green ? t.ansi2 : i < green + red ? t.ansi1 : t.hover),
    );
    const tag = f.fresh ? ["new", t.ansi2] : f.gone ? ["deleted", t.ansi1] : f.binary ? ["binary", t.dim] : null;
    return this.card(t, h_flex())
      .h_full()
      .px(10)
      .gap(10)
      .items_center()
      .bg(t.raised)
      .border_t(1)
      .rounded_t(8)
      .when(!open, (el) => el.border_b(1).rounded_b(8))
      .cursor_pointer()
      .child(svg(`mods/files/${open ? "chevron-down" : "chevron-right"}.svg`).size(13).flex_none().text_color(t.dim))
      .child(
        h_flex()
          .min_w(0)
          .text_size(12.5)
          .child(div().min_w(0).truncate().text_color(t.muted).child(dirOf(f.path)))
          .child(div().flex_none().text_color(f.gone ? t.muted : t.foreground).child(nameOf(f.path))),
      )
      .when(Boolean(tag), (el) => el.child(div().flex_none().px(6).rounded(4).border_1().border_color(t.border).text_size(10.5).text_color(tag[1]).child(tag[0])))
      .when(f.add > 0, (el) => el.child(div().flex_none().text_size(12).text_color(t.ansi2).child(`+${f.add}`)))
      .when(f.del > 0, (el) => el.child(div().flex_none().text_size(12).text_color(t.ansi1).child(`−${f.del}`)))
      .child(h_flex().flex_none().gap(2).children(blocks))
      .child(div().flex_1());
  }

  row(t, r) {
    if (r.kind === "gap") return div().h(SIZE.gap);
    if (r.kind === "head") return this.head(t, r);
    if (r.kind === "end") return this.card(t, div()).h_full().border_b(1).rounded_b(8);
    if (r.kind === "note")
      return this.card(t, h_flex())
        .h_full()
        .px(14)
        .items_center()
        .text_size(12)
        .text_color(r.action ? t.accent : t.dim)
        .when(Boolean(r.action), (el) => el.cursor_pointer())
        .child(r.text);
    if (r.kind === "hunk")
      return this.card(t, h_flex())
        .h_full()
        .px(12)
        .items_center()
        .bg(t.ansi4 + "16")
        .text_color(t.ansi4)
        .child(div().truncate().child(r.text));
    const w = this.gutter(r.digits);
    const tint = r.sign === "+" ? t.ansi2 : r.sign === "-" ? t.ansi1 : null;
    return this.card(t, h_flex())
      .h_full()
      .when(Boolean(tint), (el) => el.bg(tint + "1c"))
      .child(div().w(w).h_full().flex_none().pr(8).text_right().text_color(t.dim).when(Boolean(tint), (el) => el.bg(tint + "2a")).child(r.old === undefined ? "" : String(r.old)))
      .child(div().w(w).h_full().flex_none().pr(8).text_right().text_color(t.dim).when(Boolean(tint), (el) => el.bg(tint + "2a")).child(r.new === undefined ? "" : String(r.new)))
      .child(div().w(18).flex_none().text_center().text_color(tint ?? t.dim).child(r.more || r.sign === " " ? "" : r.sign))
      .child(h_flex().flex_1().min_w(0).overflow_hidden().whitespace_nowrap().pr(12).text_color(t.foreground)
        .when(!r.text, (el) => el.child(" "))
        .children(r.spans.map((s) => div().flex_none().when(Boolean(s.kind), (el) => el.text_color(t[SYNTAX[s.kind]])).child(s.text))));
  }

  treeRow(t, n) {
    const indent = 8 + n.depth * 14;
    if (n.kind === "dir") {
      const closed = this.closedDirs.has(n.path);
      return h_flex()
        .id(`fc-dir-${n.path}`)
        .h(26)
        .flex_none()
        .pl(indent)
        .pr(8)
        .gap(6)
        .items_center()
        .rounded(6)
        .text_color(t.foreground)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          closed ? this.closedDirs.delete(n.path) : this.closedDirs.add(n.path);
          cx.notify();
        })
        .child(svg(`mods/files/${closed ? "chevron-right" : "chevron-down"}.svg`).size(12).flex_none().text_color(t.dim))
        .child(svg("mods/files/folder.svg").size(14).flex_none().text_color(t.ansi4))
        .child(div().min_w(0).truncate().child(n.label));
    }
    const f = n.file;
    const [icon, color, word] = f.fresh ? ["added", t.ansi2, "added"] : f.gone ? ["deleted", t.ansi1, "deleted"] : ["modified", t.ansi3, f.binary ? "binary" : "modified"];
    return h_flex()
      .id(`fc-file-${n.path}`)
      .h(26)
      .flex_none()
      .pl(indent + 18)
      .pr(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .text_color(t.foreground)
      .when(this.current === n.path, (el) => el.bg(t.selected))
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(`${n.path} · ${word}`)
      .on_click((_e, cx) => this.jump(n.path, cx))
      .child(svg(`fleet-icons/${icon}.svg`).size(14).flex_none().text_color(color))
      .child(div().flex_1().min_w(0).truncate().child(n.label));
  }

  render(cx) {
    const t = theme();
    if (place()?.key !== this.key) this.refresh(cx);
    const add = this.files.reduce((n, f) => n + f.add, 0);
    const del = this.files.reduce((n, f) => n + f.del, 0);
    const count = this.files.length;
    const shownTree = this.whole >= TREE_FROM;
    const nodes = tree(this.files.filter((f) => this.matches(f)));
    const hidden = (n) => [...this.closedDirs].some((d) => n.path !== d && n.path.startsWith(d));
    const empty = this.error
      ? ["Could not read the changes.", this.error]
      : !this.title
        ? ["Reading changes…", place()?.sandbox ? `from ${place().sandbox}` : "from this tab's checkout"]
        : count === 0
          ? ["No changes yet.", "The checkout matches its base."]
          : null;
    const filterBox = div()
      .id("fc-filter")
      .h(28)
      .flex_none()
      .px(10)
      .flex()
      .items_center()
      .rounded(6)
      .border_1()
      .border_color(t.border)
      .bg(t.chrome)
      .cursor_text()
      .child(Input.new(this.filter).h_full().text_size(12).text_color(t.foreground));
    return v_flex()
      .id("fleet-changes")
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.whole) < 1) return;
        this.whole = size.width;
        cx.notify();
      })
      .size_full()
      .min_h(0)
      .rounded(10)
      .overflow_hidden()
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .text_color(t.foreground)
      .text_size(13)
      .child(
        h_flex()
          .h(40)
          .flex_none()
          .px(14)
          .gap(8)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(div().flex_none().text_color(t.dim).child(this.title ? "Changes in" : "Changes"))
          .child(div().min_w(0).truncate().child(this.title))
          .when(count > 0, (el) =>
            el
              .child(div().flex_none().text_color(t.dim).child(`· ${count} ${count === 1 ? "file" : "files"} ·`))
              .child(div().flex_none().text_color(t.ansi2).child(`+${add}`))
              .child(div().flex_none().text_color(t.ansi1).child(`−${del}`)),
          )
          .child(div().flex_1()),
      )
      .when(Boolean(empty), (el) =>
        el.child(
          v_flex()
            .p(24)
            .gap(6)
            .max_w(420)
            .child(h_flex().gap(8).items_center()
              .when(!this.error && !this.title, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(14).flex_none().text_color(t.working).spin(900)))
              .child(div().text_color(t.foreground).child(empty[0])))
            .child(div().text_size(12).text_color(t.muted).child(empty[1])),
        ),
      )
      .when(!empty, (el) =>
        el.child(
          h_flex()
            .flex_1()
            .min_h(0)
            .when(shownTree, (el) =>
              el.child(
                v_flex()
                  .w(TREE_W)
                  .h_full()
                  .flex_none()
                  .min_h(0)
                  .border_r(1)
                  .border_color(t.border)
                  .child(div().p(10).child(filterBox))
                  .child(
                    v_flex()
                      .id("fc-tree")
                      .flex_1()
                      .min_h(0)
                      .px(6)
                      .pb(10)
                      .overflow_y_scrollbar()
                      .children(nodes.filter((n) => !hidden(n)).map((n) => this.treeRow(t, n))),
                  ),
              ),
            )
            .child(
              v_flex()
                .flex_1()
                .h_full()
                .min_w(0)
                .min_h(0)
                .when(!shownTree, (el) => el.child(div().px(12).pt(10).child(filterBox)))
                .when(this.rows.length === 0, (el) => el.child(div().p(16).text_size(12).text_color(t.muted).child(`No file matches "${this.query}".`)))
                .child(
                  div()
                    .flex_1()
                    .min_h(0)
                    .relative()
                    .pt(12)
                    .font_family(settings().font_family ?? "JetBrains Mono")
                    .text_size(12)
                    .id("fc-body")
                    .on_size_change((size, cx) => {
                      this.height = size.height;
                      this.resized(size.width, cx);
                    })
                    .child(
                      v_virtual_list(
                        "fc-diff",
                        this.rows.length,
                        this.rows.map((r) => SIZE[r.kind]),
                        (i) => this.rows[i].key,
                        (range) => this.rows.slice(range.start, range.end).map((r) => this.row(t, r)),
                      )
                        .track_scroll(this.scroll)
                        .on_item_click((key, cx) => this.clicked(key, cx))
                        .size_full(),
                    )
                    .child(Scrollbar.vertical("fc-diff").viewport_from_layout().absolute().inset_0()),
                ),
            ),
        ),
      );
  }
}
