// Runs inside the captured page (passed to page.evaluate as a string).
// Adapted from hotshot-destroy/server/extract.js.
// Collects breakable pieces in the first LIMIT px of the document: controls,
// media, text chunks and the boxes that contain them (cards, bars, inputs).
// The page is scrolled to the top, so viewport coordinates are document coordinates.
// `MAX_CHUNK` (px) and `LIMIT` (px) are substituted by the server.
(() => {
  const MAX_CHUNK = __MAX_CHUNK__;
  const VW = innerWidth, VH = __LIMIT__;
  const out = [];
  // The server may run this several times with bigger chunks: start from a clean slate.
  for (const el of document.querySelectorAll('[data-hb]')) el.removeAttribute('data-hb');

  const visible = (el) => {
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05;
  };
  // Document coordinates, so a page that is not exactly at the top still lines up with the screenshot.
  const SX = scrollX, SY = scrollY;
  const clip = (r) => {
    const x = Math.max(0, r.left + SX), y = Math.max(0, r.top + SY);
    const x2 = Math.min(VW, r.right + SX), y2 = Math.min(VH, r.bottom + SY);
    return x2 - x >= 4 && y2 - y >= 4 ? { x, y, w: x2 - x, h: y2 - y } : null;
  };
  const transparent = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
  const hasBox = (cs) =>
    !transparent(cs.backgroundColor) ||
    cs.backgroundImage !== 'none' ||
    (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && !transparent(cs.borderTopColor));
  const marked = (n) => {
    for (let e = n.nodeType === 1 ? n : n.parentElement; e; e = e.parentElement) if (e.hasAttribute('data-hb')) return true;
    return false;
  };
  const bgOf = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = getComputedStyle(e).backgroundColor;
      if (!transparent(c)) return c;
    }
    return 'rgb(255, 255, 255)';
  };

  // Controls: buttons, inputs, and links/labels styled as boxes.
  for (const el of document.querySelectorAll('button, input:not([type=hidden]), select, textarea, [role=button], a, label')) {
    if (marked(el) || !visible(el)) continue;
    const cs = getComputedStyle(el);
    const loose = el.tagName === 'A' || el.tagName === 'LABEL' || el.getAttribute('role') === 'button';
    if (loose && !hasBox(cs)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 600 || r.height > 200) continue;
    const c = clip(r);
    if (!c) continue;
    el.setAttribute('data-hb', '');
    out.push({ ...c, cat: 'control' });
  }

  // Media: images, svg, video... plus small elements painted with a background image (logos, icons).
  for (const el of document.querySelectorAll('body *')) {
    const tag = el.tagName.toLowerCase();
    const isMedia = ['img', 'svg', 'video', 'canvas', 'iframe', 'object', 'embed'].includes(tag);
    if (!isMedia) {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg.includes('url(')) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height > 300 * 300) continue;
    }
    if (marked(el) || !visible(el)) continue;
    const c = clip(el.getBoundingClientRect());
    if (!c) continue;
    el.setAttribute('data-hb', '');
    out.push({ ...c, cat: 'media' });
  }

  // Text: words grouped into chunks along each line.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let n;
  while ((n = walker.nextNode())) {
    const text = n.textContent;
    if (!text || !text.trim()) continue;
    const pe = n.parentElement;
    if (!pe || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION)$/.test(pe.tagName) || marked(pe) || !visible(pe)) continue;
    const cs = getComputedStyle(pe);
    if (transparent(cs.color)) continue;
    const fs = parseFloat(cs.fontSize) || 16;
    const cat = fs >= 30 ? 'title' : 'text';
    const re = /\S+/g;
    let m, cur = null;
    while ((m = re.exec(text))) {
      range.setStart(n, m.index);
      range.setEnd(n, m.index + m[0].length);
      for (const r of range.getClientRects()) {
        const c = clip(r);
        if (!c) continue;
        const sameLine = cur && Math.abs(c.y - cur.y) < 3 && c.x - (cur.x + cur.w) < fs * 0.8;
        if (sameLine && c.x + c.w - cur.x <= MAX_CHUNK) {
          cur.w = c.x + c.w - cur.x;
          cur.h = Math.max(cur.h, c.y + c.h - cur.y);
        } else {
          if (cur) out.push(cur);
          cur = { ...c, cat };
        }
      }
    }
    if (cur) out.push(cur);
  }

  // Boxes: painted containers (own background, border or shadow).
  const boxes = [];
  for (const el of document.querySelectorAll('body *')) {
    if (marked(el) || !visible(el)) continue;
    const c = clip(el.getBoundingClientRect());
    if (!c || c.w < 24 || c.h < 14 || c.w * c.h > VW * VH * 0.9) continue;
    const cs = getComputedStyle(el);
    const ownBg = !transparent(cs.backgroundColor) && cs.backgroundColor !== bgOf(el.parentElement);
    const border = ['Top', 'Right', 'Bottom', 'Left'].some(
      (s) => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none' && !transparent(cs['border' + s + 'Color']),
    );
    if (!ownBg && !border && cs.boxShadow === 'none' && cs.backgroundImage === 'none') continue;
    if (boxes.some((b) => Math.abs(b.x - c.x) < 3 && Math.abs(b.y - c.y) < 3 && Math.abs(b.w - c.w) < 3 && Math.abs(b.h - c.h) < 3)) continue;
    boxes.push({ ...c, cat: 'box' });
    if (boxes.length >= 140) break;
  }

  return { title: document.title, blocks: [...boxes, ...out] };
})()
