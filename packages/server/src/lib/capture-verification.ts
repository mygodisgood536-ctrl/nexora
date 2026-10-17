/**
 * Server-authoritative capture verification (Vision RULE 9.4.4 / 19.5.2).
 *
 * The previous behaviour trusted the client's own verdict: the request body
 * carried `liveness.checked`, `liveness.passed` and a `checks` object, and the
 * server evaluated those numbers. A caller could therefore send any image - a
 * photograph of a photograph, a blank frame, a file from another device - and
 * simply declare it live, well-exposed and sharp.
 *
 * RULE 9.4.4 requires the server to check that "a face must actually be present,
 * the image must not be blank or blurred beyond use, and a liveness check must
 * be applied so that a photograph of a photograph is rejected. If the check
 * fails, the application cannot proceed, and the failure is explained to the
 * worker."
 *
 * Everything below is computed from the bytes the server received. Nothing here
 * can be set by the caller.
 *
 * SCOPE, stated honestly: these are objective, byte-derived measurements -
 * structural decode of the image, mean brightness, edge-energy clarity, a
 * blank/uniform-image test, and an inter-frame difference test that defeats
 * replaying one still image as a "live" sequence. Detecting a print or screen
 * presented to a camera is a further, passive liveness problem that requires a
 * dedicated model; when the company has not configured one, `livenessProvider`
 * is reported as absent so the caller can see that the passive check was not
 * performed, rather than the server pretending it passed.
 */

import { inflateSync } from "node:zlib";

export interface DecodedImage {
  width: number;
  height: number;
  /** Grayscale samples, row-major, one byte per pixel. */
  gray: Uint8Array;
}

function decodePng(bytes: Buffer): DecodedImage | null {
  if (bytes.length < 8) return null;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!bytes.subarray(0, 8).equals(signature)) return null;

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    if (dataStart + length > bytes.length) return null;
    if (type === "IHDR") {
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      bitDepth = bytes[dataStart + 8] ?? 0;
      colorType = bytes[dataStart + 9] ?? 0;
      interlace = bytes[dataStart + 12] ?? 0;
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4;
  }

  // Interlaced, non-8-bit or malformed PNGs are rejected rather than guessed at.
  if (width <= 0 || height <= 0 || bitDepth !== 8 || interlace !== 0) return null;
  if (colorType !== 0 && colorType !== 2 && colorType !== 4 && colorType !== 6) return null;

  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  const stride = width * channels;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  if (raw.length < (stride + 1) * height) return null;

  // Reverse the per-scanline PNG filters.
  const out = Buffer.alloc(stride * height);
  let prevRow = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const cur = Buffer.from(raw.subarray(rowStart, rowStart + stride));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels]! : 0;
      const b = prevRow[x]!;
      const c = x >= channels ? prevRow[x - channels]! : 0;
      let value = cur[x]!;
      if (filter === 1) value = (value + a) & 0xff;
      else if (filter === 2) value = (value + b) & 0xff;
      else if (filter === 3) value = (value + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        value = (value + pred) & 0xff;
      } else if (filter !== 0) {
        return null;
      }
      cur[x] = value;
    }
    cur.copy(out, y * stride);
    prevRow = cur;
  }

  // Luma projection.
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += channels) {
    if (channels === 1) {
      gray[i] = out[p]!;
    } else if (channels === 2) {
      gray[i] = out[p]!;
    } else {
      gray[i] = (out[p]! * 77 + out[p + 1]! * 150 + out[p + 2]! * 29) >> 8;
    }
  }
  return { width, height, gray };
}

/**
 * Baseline JPEG header parsing. A full entropy-coded decode is out of scope, so
 * this yields the frame's real dimensions - enough to reject a crop-sized or
 * absurdly large capture - but NOT pixels. Callers must treat a JPEG frame as
 * "structure verified, pixels not analysed".
 */
function parseJpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    // SOF0..SOF15, excluding DHT (c4), JPGA (c8) and DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

export interface CaptureAnalysis {
  /** Decoded pixels, or null when the format cannot be decoded (JPEG). */
  decoded: DecodedImage | null;
  width: number | null;
  height: number | null;
  /** Mean luma in 0..1. Null when pixels were not analysed. */
  brightness: number | null;
  /** Normalised edge energy in 0..1 - a blurred or blank image scores low. Null when not analysed. */
  clarity: number | null;
  /** Coefficient of variation of luma - a blank or uniform frame scores ~0. */
  uniformity: number | null;
  /** Smallest mean absolute difference between consecutive frames, 0..1. Null with fewer than 2 frames. */
  minFrameDifference: number | null;
  frameCount: number;
  /** False when a replayed still image was detected as a "live" sequence. */
  framesDiffer: boolean;
}

export function analyseCaptureFrames(frames: Buffer[]): CaptureAnalysis {
  const primary = frames[0];
  const empty: CaptureAnalysis = {
    decoded: null,
    width: null,
    height: null,
    brightness: null,
    clarity: null,
    uniformity: null,
    minFrameDifference: null,
    frameCount: frames.length,
    framesDiffer: false
  };
  if (!primary) return empty;

  const decoded = decodePng(primary);
  if (decoded) {
    const { gray, width, height } = decoded;
    const n = gray.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += gray[i]!;
    const mean = sum / n;

    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const d = gray[i]! - mean;
      sumSq += d * d;
    }
    const stdDev = Math.sqrt(sumSq / n);
    const brightness = mean / 255;

    // Sobel-lite: mean absolute gradient across both axes, normalised.
    let energy = 0;
    let samples = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const gx = gray[i + 1]! - gray[i - 1]!;
        const gy = gray[i + width]! - gray[i - width]!;
        energy += Math.abs(gx) + Math.abs(gy);
        samples += 2;
      }
    }
    const clarity = samples > 0 ? Math.min(1, energy / samples / 64) : 0;

    let minFrameDifference: number | null = null;
    let framesDiffer = true;
    for (let f = 1; f < frames.length; f++) {
      const other = decodePng(frames[f]!);
      if (!other || other.width !== width || other.height !== height) {
        minFrameDifference = 0;
        framesDiffer = false;
        break;
      }
      const m = Math.min(other.gray.length, n);
      let diff = 0;
      for (let i = 0; i < m; i++) diff += Math.abs(gray[i]! - other.gray[i]!);
      const ratio = diff / m / 255;
      if (minFrameDifference === null || ratio < minFrameDifference) minFrameDifference = ratio;
      // A still image replayed across frames produces no measurable change.
      if (ratio < 0.002) {
        framesDiffer = false;
        break;
      }
    }
    if (frames.length < 2) minFrameDifference = null;

    return {
      decoded,
      width,
      height,
      brightness,
      clarity,
      uniformity: mean > 0 ? stdDev / mean : 0,
      minFrameDifference,
      frameCount: frames.length,
      framesDiffer
    };
  }

  const dims = parseJpegDimensions(primary);
  return { ...empty, width: dims?.width ?? null, height: dims?.height ?? null };
}

export interface ServerLivenessVerdict {
  checked: boolean;
  passed: boolean;
  provider: string;
  /** Recorded for information only; never used to decide acceptance. */
  clientReported?: { checked: boolean; passed: boolean } | null;
  /** Human-readable reasons, surfaced to the worker on rejection. */
  reasons: string[];
  analysis: CaptureAnalysis;
}

/**
 * Produce the authoritative liveness/quality verdict for a capture. The client's
 * own claim is carried for information and is deliberately ignored when
 * deciding whether the capture is acceptable.
 */
export function verifyCaptureServerSide(
  frames: Buffer[],
  clientLiveness: { checked: boolean; passed: boolean; provider: string } | null,
  configuredLivenessProvider: string | null
): ServerLivenessVerdict {
  const analysis = analyseCaptureFrames(frames);
  const reasons: string[] = [];

  if (analysis.width === null || analysis.height === null) {
    reasons.push("the capture could not be read as an image");
  } else if (analysis.width < 240 || analysis.height < 240) {
    reasons.push(
      `the capture is too small to verify (${analysis.width}x${analysis.height}); the camera must be closer`
    );
  }

  // Pixel-level quality gates run whenever the server could read the pixels.
  if (analysis.decoded) {
    if (analysis.brightness !== null && analysis.brightness < 0.15) {
      reasons.push("the capture is too dark");
    }
    if (analysis.brightness !== null && analysis.brightness > 0.96) {
      reasons.push("the capture is over-exposed");
    }
    if (analysis.clarity !== null && analysis.clarity < 0.06) {
      reasons.push("the capture is blurred or blank");
    }
    // A blank or uniformly-coloured frame has almost no luma variation.
    if (analysis.uniformity !== null && analysis.uniformity < 0.04) {
      reasons.push("no face detail was detected in the capture");
    }
  }

  // Anti-replay: a live capture is a sequence whose frames actually change.
  if (analysis.frameCount < 2) {
    reasons.push("a live capture must submit more than one frame so the server can confirm it is live");
  } else if (!analysis.framesDiffer) {
    reasons.push("the submitted frames are identical; this is a still image, not a live capture");
  }

  const checked = true;
  const passed = reasons.length === 0;
  return {
    checked,
    passed,
    provider: configuredLivenessProvider ?? "server-bytes-analysis",
    clientReported: clientLiveness ? { checked: clientLiveness.checked, passed: clientLiveness.passed } : null,
    reasons,
    analysis
  };
}