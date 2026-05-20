const INF = 1e10;

function dt1d(f: Float32Array, n: number): Float32Array {
  const d = new Float32Array(n);
  const v = new Int32Array(n);
  const z = new Float32Array(n + 1);

  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;

  for (let q = 1; q < n; q++) {
    let s: number;
    for (;;) {
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      if (s > z[k]) break;
      k--;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }

  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }

  return d;
}

export function squaredEDT(grid: Float32Array, w: number, h: number): Float32Array {
  const result = new Float32Array(w * h);
  result.set(grid);

  const buf = new Float32Array(Math.max(w, h));

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) buf[y] = result[y * w + x];
    const d = dt1d(buf, h);
    for (let y = 0; y < h; y++) result[y * w + x] = d[y];
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) buf[x] = result[y * w + x];
    const d = dt1d(buf, w);
    for (let x = 0; x < w; x++) result[y * w + x] = d[x];
  }

  return result;
}

export function initEDT(mask: Uint8Array, n: number, foregroundIsZero: boolean): Float32Array {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    buf[i] = foregroundIsZero ? (mask[i] ? 0 : INF) : (mask[i] ? INF : 0);
  }
  return buf;
}

export function detectThinPixels(
  mask: Uint8Array,
  sqDistToBg: Float32Array,
  gridW: number,
  gridH: number,
  radiusSq: number,
): Uint8Array {
  const n = gridW * gridH;

  const eroded = new Uint8Array(n);
  let hasCore = false;
  for (let i = 0; i < n; i++) {
    if (mask[i] && sqDistToBg[i] >= radiusSq) {
      eroded[i] = 1;
      hasCore = true;
    }
  }

  if (!hasCore) return mask;

  const dtBuf = initEDT(eroded, n, true);
  const sqDistToCore = squaredEDT(dtBuf, gridW, gridH);

  const thin = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (mask[i] && sqDistToCore[i] > radiusSq) thin[i] = 1;
  }
  return thin;
}
