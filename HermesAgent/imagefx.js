// Image processing for design prep — makes a design's background match the
// product it's printed on.
//
// The Higgsfield designs are generated on a plain white background. For
// print-on-demand we turn that white TRANSPARENT so the fabric color shows
// through on every garment variant. We use a "leaky" flood-fill from the image
// borders: it travels freely through background white AND leaks through up to
// MAX_BARRIER consecutive non-white pixels (a letter stroke) to reach white
// trapped INSIDE letters and numbers — the counter of an O, 0, 6, A, R, etc.
// White that's walled off behind a *thicker* colored shape (e.g. a solid banner
// with white text, or white text on a dark box) is more than MAX_BARRIER pixels
// from the background, so it is preserved as intentional design.
//
// Optionally recolor the background to a solid hex instead of transparent.

import Jimp from "jimp";

const WHITE_THRESHOLD = 238; // R,G,B all above this counts as "background white"
const MAX_BARRIER = 22;      // px of contiguous ink the fill can leak across (≈ a bold letter stroke)

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

/**
 * @param {Buffer} buffer  source image bytes
 * @param {string|null|object} opts  null/"#RRGGBB" (back-compat: fill color) or
 *   { solidHex?: string|null, maxBarrier?: number, threshold?: number }
 * @returns {Promise<{buffer: Buffer, changed: number, total: number}>}
 */
export async function matchBackground(buffer, opts = null) {
  if (typeof opts === "string" || opts === null) opts = { solidHex: opts };
  const { solidHex = null, maxBarrier = MAX_BARRIER, threshold = WHITE_THRESHOLD } = opts;

  const image = await Jimp.read(buffer);
  const { width, height, data } = image.bitmap; // RGBA, 4 bytes/pixel
  const N = width * height;
  const isWhite = (p) => data[p * 4] >= threshold && data[p * 4 + 1] >= threshold && data[p * 4 + 2] >= threshold;

  // 0-1 BFS on "consecutive ink crossed since the last background white":
  // entering white resets the count to 0 (and the white is removable); entering
  // ink adds 1. Pixels stay reachable while the count ≤ maxBarrier. Each pixel
  // is finalized once at its minimum count, so this is O(N).
  const K = maxBarrier;
  const dist = new Int16Array(N).fill(0x7fff); // sentinel "unvisited" (Int16Array can't hold Infinity)
  const remove = new Uint8Array(N);
  const dq = new Int32Array(3 * N + 8);
  let head = N + 4, tail = N + 4; // room to push toward the front
  const pushFront = (p) => { dq[--head] = p; };
  const pushBack = (p) => { dq[tail++] = p; };
  const relax = (p, d) => {
    if (d <= K && d < dist[p]) {
      dist[p] = d;
      if (isWhite(p)) { remove[p] = 1; pushFront(p); } // d is 0 → process first
      else pushBack(p);                                // ink → process after the 0-cost whites
    }
  };
  for (let x = 0; x < width; x++) { relax(x, isWhite(x) ? 0 : 1); const p = (height - 1) * width + x; relax(p, isWhite(p) ? 0 : 1); }
  for (let y = 0; y < height; y++) { const a = y * width; relax(a, isWhite(a) ? 0 : 1); const b = a + width - 1; relax(b, isWhite(b) ? 0 : 1); }

  while (head < tail) {
    const p = dq[head++];
    const d = dist[p];
    const x = p % width, y = (p - x) / width;
    const nbrs = [];
    if (x > 0) nbrs.push(p - 1);
    if (x < width - 1) nbrs.push(p + 1);
    if (y > 0) nbrs.push(p - width);
    if (y < height - 1) nbrs.push(p + width);
    for (const q of nbrs) {
      const nd = isWhite(q) ? 0 : d + 1;
      if (nd <= K && nd < dist[q]) {
        dist[q] = nd;
        if (isWhite(q)) { remove[q] = 1; pushFront(q); }
        else pushBack(q);
      }
    }
  }

  const fill = solidHex ? hexToRgb(solidHex) : null;
  let changed = 0;
  for (let p = 0; p < N; p++) {
    if (!remove[p]) continue;
    const i = p * 4;
    if (fill) { data[i] = fill.r; data[i + 1] = fill.g; data[i + 2] = fill.b; data[i + 3] = 255; }
    else { data[i + 3] = 0; }
    changed++;
  }

  const out = await image.getBufferAsync(Jimp.MIME_PNG);
  return { buffer: out, changed, total: N };
}

/**
 * Crop the image down to the bounding box of its visible content, so the design
 * fills the product's print area instead of floating in empty margins
 * ("crop to fit"). After matchBackground the margins are transparent, so we crop
 * to the non-transparent bounds; if the image has no transparency we trim the
 * near-white border instead.
 * @param {Buffer} buffer
 * @param {{pad?: number, alphaThreshold?: number}} [opts] pad = px of breathing room kept
 * @returns {Promise<{buffer: Buffer, width: number, height: number, cropped: boolean}>}
 */
export async function cropToContent(buffer, { pad = 4, alphaThreshold = 8 } = {}) {
  const image = await Jimp.read(buffer);
  const { width, height, data } = image.bitmap;

  let transparent = false;
  for (let i = 3; i < data.length; i += 4) { if (data[i] < 250) { transparent = true; break; } }
  const visible = transparent
    ? (i) => data[i + 3] > alphaThreshold
    : (i) => !(data[i] >= WHITE_THRESHOLD && data[i + 1] >= WHITE_THRESHOLD && data[i + 2] >= WHITE_THRESHOLD);

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (visible((y * width + x) * 4)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return { buffer, width, height, cropped: false }; // nothing visible

  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const w = maxX - minX + 1, h = maxY - minY + 1;
  if (w === width && h === height) return { buffer, width, height, cropped: false };
  image.crop(minX, minY, w, h);
  const out = await image.getBufferAsync(Jimp.MIME_PNG);
  return { buffer: out, width: w, height: h, cropped: true };
}

/**
 * Fetch a remote image and prepare it for print: optionally match the
 * background to the garment (transparent) and crop it to its content so it fits
 * the print area. Returns base64 PNG plus the final dimensions (used to compute
 * the placement scale so the design fills the product).
 * @param {string} imageUrl
 * @param {{matchBg?: boolean, crop?: boolean, solidHex?: string|null}} [opts]
 */
export async function prepareDesign(imageUrl, opts = {}) {
  // Back-compat: prepareDesign(url, "#rrggbb") still means "fill bg with hex".
  if (typeof opts === "string" || opts === null) opts = { solidHex: opts };
  const { matchBg = true, crop = true, solidHex = null } = opts;

  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Could not fetch design image: ${res.status}`);
  let buffer = Buffer.from(await res.arrayBuffer());

  let pctChanged = 0;
  if (matchBg) {
    const r = await matchBackground(buffer, solidHex);
    buffer = r.buffer;
    pctChanged = Math.round((r.changed / r.total) * 100);
  }

  let cropped = false, width = null, height = null;
  if (crop) {
    const c = await cropToContent(buffer);
    buffer = c.buffer; cropped = c.cropped; width = c.width; height = c.height;
  } else {
    const meta = await Jimp.read(buffer);
    width = meta.bitmap.width; height = meta.bitmap.height;
  }

  return { base64: buffer.toString("base64"), pctChanged, width, height, cropped };
}
