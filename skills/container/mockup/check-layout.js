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
    if ((clipsX || clipsY) && text(node)) {
      findings.push({ kind: "clipped", where: name(node), detail: `"${text(node)}" content ${node.scrollWidth}×${node.scrollHeight} in box ${node.clientWidth}×${node.clientHeight}` });
    }

    if (outside(node) && !(node.parentElement !== document.body && outside(node.parentElement)) && !scrolls(node)) {
      findings.push({ kind: "off-viewport", where: name(node), detail: `spans ${Math.round(r.left)}..${Math.round(r.right)} in viewport ${vw}` });
    }

    const label = [...node.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join("").trim();
    if (label && label.length <= 40 && !/^(h[1-6]|p|pre|code)$/.test(node.localName) && node.children.length === 0) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const lines = new Set([...range.getClientRects()].filter(q => q.width > 0).map(q => Math.round(q.top)));
      if (lines.size > 1) findings.push({ kind: "wrapped-label", where: name(node), detail: `"${label}" on ${lines.size} lines` });
    }
  }

  const unique = [...new Map(findings.map(f => [`${f.kind}|${f.where}|${f.detail}`, f])).values()];
  return { viewport: `${vw}×${document.documentElement.clientHeight}`, count: unique.length, findings: unique };
}
