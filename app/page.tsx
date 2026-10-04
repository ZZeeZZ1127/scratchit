"use client";

import {
  ChangeEvent,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

type RGB = [number, number, number];

interface CircleNode {
  x: number;
  y: number;
  w: number;
  h: number;
  color: RGB;
  level: number;
  targetSize: number;
  parent: CircleNode | null;
  children: CircleNode[] | null;
}

interface Palette {
  colors: string[];
  textColor: string;
}

type ThemeKey = "photo" | "ivory" | "sage" | "dusk" | "rose";

interface ResolvedPostcardTheme {
  background: string[];
  paper: string;
  ink: string;
  muted: string;
  panel: string;
}

const THEME_OPTIONS: Array<{
  key: ThemeKey;
  label: string;
  swatches: string[];
}> = [
  { key: "photo", label: "Photo", swatches: [] },
  { key: "ivory", label: "Ivory", swatches: ["#d8c6ae", "#f5efe5", "#736457"] },
  { key: "sage", label: "Sage", swatches: ["#738574", "#dce3d8", "#344239"] },
  { key: "dusk", label: "Dusk", swatches: ["#363544", "#8d7180", "#e2c8bb"] },
  { key: "rose", label: "Rose", swatches: ["#a96f70", "#ead1c7", "#6d4548"] }
];

interface IntegralImage {
  width: number;
  height: number;
  stride: number;
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
}

type Screen = "upload" | "reveal" | "postcard";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_EDGE = 1600;
const FINAL_CELL = 6;
const EXPORT_W = 1748;
const EXPORT_H = 1240;
const FALLBACK_QUOTES = [
  "Every picture tells a story.",
  "Small moments make the biggest memories.",
  "Let the little things spark joy.",
  "Hold close the light hidden in ordinary moments.",
  "Today’s quiet details can become tomorrow’s brightest memories.",
  "Beauty grows wherever attention and gratitude meet.",
  "Carry this moment forward with courage and wonder.",
  "Joy often begins in the places we pause to notice.",
  "The simplest scenes can hold the deepest meaning.",
  "Let this memory remind you how far you have come.",
  "There is always more light waiting to be noticed.",
  "Keep making room for moments that feel alive."
];

function clamp(value: number, min = 0, max = 255) {
  return Math.min(max, Math.max(min, value));
}

function rgbCss([r, g, b]: RGB) {
  return `rgb(${r}, ${g}, ${b})`;
}

function rgbToHex([r, g, b]: RGB) {
  return `#${[r, g, b]
    .map((value) => Math.round(value).toString(16).padStart(2, "0"))
    .join("")}`;
}

function hexToRgb(hex: string): RGB {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

function mixRgb(a: RGB, b: RGB, amount: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * amount),
    Math.round(a[1] + (b[1] - a[1]) * amount),
    Math.round(a[2] + (b[2] - a[2]) * amount)
  ];
}

function resolvePostcardTheme(
  palette: Palette,
  themeKey: ThemeKey
): ResolvedPostcardTheme {
  if (themeKey === "ivory") {
    return {
      background: ["#b9a58f", "#e6dac9", "#75685e"],
      paper: "#f7f2e9",
      ink: "#29251f",
      muted: "#6d655b",
      panel: "#d8c1aa"
    };
  }
  if (themeKey === "sage") {
    return {
      background: ["#617564", "#a9b7a5", "#33423a"],
      paper: "#f0f2eb",
      ink: "#26312a",
      muted: "#5f6b62",
      panel: "#9eac98"
    };
  }
  if (themeKey === "dusk") {
    return {
      background: ["#292936", "#765d70", "#c59d91"],
      paper: "#f1ece9",
      ink: "#2c2830",
      muted: "#6e6670",
      panel: "#8e7180"
    };
  }
  if (themeKey === "rose") {
    return {
      background: ["#8c555b", "#c9918a", "#e5c5b8"],
      paper: "#f8efeb",
      ink: "#3c292b",
      muted: "#785f60",
      panel: "#c58e82"
    };
  }

  const colors = palette.colors.length
    ? palette.colors
    : ["#d8c7b2", "#78909c", "#5d6b72"];
  const base = hexToRgb(colors[0]);
  const second = hexToRgb(colors[1] || colors[0]);
  const paperRgb = mixRgb(base, [250, 248, 243], 0.9);
  const paper = rgbToHex(paperRgb);
  const ink = bestTextColor(paperRgb);
  return {
    background: [colors[0], colors[1] || colors[0], colors[2] || colors[0]],
    paper,
    ink,
    muted: rgbToHex(mixRgb(hexToRgb(ink), paperRgb, 0.42)),
    panel: colors[3] || rgbToHex(mixRgb(base, second, 0.5))
  };
}

function luminance([r, g, b]: RGB) {
  const values = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}

function contrast(a: RGB, b: RGB) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function bestTextColor(background: RGB) {
  const dark: RGB = [20, 20, 18];
  const light: RGB = [252, 250, 245];
  return contrast(background, dark) >= contrast(background, light)
    ? rgbToHex(dark)
    : rgbToHex(light);
}

function buildIntegral(imageData: ImageData): IntegralImage {
  const { width, height, data } = imageData;
  const stride = width + 1;
  const size = stride * (height + 1);
  const r = new Uint32Array(size);
  const g = new Uint32Array(size);
  const b = new Uint32Array(size);

  for (let y = 1; y <= height; y += 1) {
    let rowR = 0;
    let rowG = 0;
    let rowB = 0;
    const sourceRow = (y - 1) * width * 4;
    const integralRow = y * stride;
    const previousRow = (y - 1) * stride;

    for (let x = 1; x <= width; x += 1) {
      const source = sourceRow + (x - 1) * 4;
      rowR += data[source];
      rowG += data[source + 1];
      rowB += data[source + 2];
      const target = integralRow + x;
      r[target] = r[previousRow + x] + rowR;
      g[target] = g[previousRow + x] + rowG;
      b[target] = b[previousRow + x] + rowB;
    }
  }

  return { width, height, stride, r, g, b };
}

function regionAverage(
  integral: IntegralImage,
  x: number,
  y: number,
  w: number,
  h: number
): RGB {
  const x2 = x + w;
  const y2 = y + h;
  const { stride } = integral;
  const a = y * stride + x;
  const b = y * stride + x2;
  const c = y2 * stride + x;
  const d = y2 * stride + x2;
  const area = Math.max(1, w * h);
  return [
    Math.round((integral.r[d] - integral.r[b] - integral.r[c] + integral.r[a]) / area),
    Math.round((integral.g[d] - integral.g[b] - integral.g[c] + integral.g[a]) / area),
    Math.round((integral.b[d] - integral.b[b] - integral.b[c] + integral.b[a]) / area)
  ];
}

function targetCellSize() {
  // The interactive tree resolves toward the same final dot pitch everywhere.
  // The postcard applies its own organic edge-to-center size distribution.
  return FINAL_CELL;
}

function createNode(
  integral: IntegralImage,
  x: number,
  y: number,
  w: number,
  h: number,
  level: number,
  parent: CircleNode | null = null
): CircleNode {
  return {
    x,
    y,
    w,
    h,
    level,
    targetSize: targetCellSize(),
    parent,
    color: regionAverage(integral, x, y, w, h),
    children: null
  };
}

function initialGrid(width: number, height: number): [number, number] {
  const aspect = width / Math.max(1, height);
  let best: [number, number] = aspect >= 1 ? [3, 2] : [2, 3];
  let bestScore = Number.POSITIVE_INFINITY;

  // Pick a small rational grid close to the photo's aspect ratio. The
  // processing canvas is fitted to this grid, so every root cell is square
  // and every initial circle is tangent without crossing the canvas edge.
  for (let columns = 1; columns <= 9; columns += 1) {
    for (let rows = 1; rows <= 9; rows += 1) {
      const count = columns * rows;
      if (count < 4 || count > 32) continue;
      const ratioError = Math.abs(Math.log(aspect / (columns / rows)));
      const countPenalty = Math.abs(count - 6) * 0.002;
      const score = ratioError + countPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = [columns, rows];
      }
    }
  }
  return best;
}

function createInitialRoot(
  integral: IntegralImage,
  columns: number,
  rows: number
): CircleNode {
  const root = createNode(integral, 0, 0, integral.width, integral.height, -1);
  const children: CircleNode[] = [];
  const cellW = integral.width / columns;
  const cellH = integral.height / rows;

  // Upload processing makes these cells square. Keeping the exact selected
  // grid here prevents a second aspect-ratio calculation from producing
  // oversized circles at the canvas edges.
  for (let row = 0; row < rows; row += 1) {
    const y = Math.round(row * cellH);
    const y2 = Math.round((row + 1) * cellH);
    for (let column = 0; column < columns; column += 1) {
      const x = Math.round(column * cellW);
      const x2 = Math.round((column + 1) * cellW);
      children.push(
        createNode(integral, x, y, x2 - x, y2 - y, 0, root)
      );
    }
  }

  root.children = children;
  return root;
}

function terminal(node: Pick<CircleNode, "w" | "h" | "targetSize">) {
  return node.w <= node.targetSize || node.h <= node.targetSize;
}

function resolutionFraction(node: CircleNode, maxDepth: number) {
  return terminal(node) ? 1 : Math.min(0.99, node.level / Math.max(1, maxDepth));
}

function childRegions(node: Pick<CircleNode, "x" | "y" | "w" | "h">) {
  const left = Math.floor(node.w / 2);
  const right = node.w - left;
  const top = Math.floor(node.h / 2);
  const bottom = node.h - top;
  return [
    [node.x, node.y, left, top],
    [node.x + left, node.y, right, top],
    [node.x, node.y + top, left, bottom],
    [node.x + left, node.y + top, right, bottom]
  ] as const;
}

function nodeRadius(node: Pick<CircleNode, "w" | "h">) {
  // Half a device pixel keeps antialiasing fully inside the node/canvas while
  // remaining visually tangent to the neighboring cell.
  return Math.max(0.25, Math.min(node.w, node.h) / 2 - 0.5);
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: CircleNode,
  scale = 1,
  centerX = node.x + node.w / 2,
  centerY = node.y + node.h / 2
) {
  // Clamp against the backing canvas as a final safety net. This guarantees
  // that animated and static circles remain complete even at edge cells.
  const radius = Math.max(
    0.25,
    Math.min(
      nodeRadius(node) * scale,
      centerX - 0.5,
      centerY - 0.5,
      ctx.canvas.width - centerX - 0.5,
      ctx.canvas.height - centerY - 0.5
    )
  );
  ctx.fillStyle = rgbCss(node.color);
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
}


function drawFinalMosaic(
  ctx: CanvasRenderingContext2D,
  integral: IntegralImage,
  clear = true
) {
  const columns = Math.max(1, Math.round(integral.width / FINAL_CELL));
  const rows = Math.max(1, Math.round(integral.height / FINAL_CELL));
  const stepX = integral.width / columns;
  const stepY = integral.height / rows;
  const radius = Math.min(stepX, stepY) / 2;

  if (clear) ctx.clearRect(0, 0, integral.width, integral.height);

  for (let row = 0; row < rows; row += 1) {
    const y = Math.round(row * stepY);
    const y2 = Math.round((row + 1) * stepY);
    for (let column = 0; column < columns; column += 1) {
      const x = Math.round(column * stepX);
      const x2 = Math.round((column + 1) * stepX);
      ctx.fillStyle = rgbCss(regionAverage(integral, x, y, x2 - x, y2 - y));
      ctx.beginPath();
      ctx.arc(
        (column + 0.5) * stepX,
        (row + 0.5) * stepY,
        radius,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }
}

interface FinalDot {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  radius: number;
  color: RGB;
}

function createFinalDots(integral: IntegralImage): FinalDot[] {
  const columns = Math.max(1, Math.round(integral.width / FINAL_CELL));
  const rows = Math.max(1, Math.round(integral.height / FINAL_CELL));
  const stepX = integral.width / columns;
  const stepY = integral.height / rows;
  const radius = Math.min(stepX, stepY) / 2;
  const dots: FinalDot[] = [];

  for (let row = 0; row < rows; row += 1) {
    const y = Math.round(row * stepY);
    const y2 = Math.round((row + 1) * stepY);
    for (let column = 0; column < columns; column += 1) {
      const x = Math.round(column * stepX);
      const x2 = Math.round((column + 1) * stepX);
      dots.push({
        x,
        y,
        w: x2 - x,
        h: y2 - y,
        cx: (column + 0.5) * stepX,
        cy: (row + 0.5) * stepY,
        radius,
        color: regionAverage(integral, x, y, x2 - x, y2 - y)
      });
    }
  }

  return dots;
}

function drawTree(ctx: CanvasRenderingContext2D, node: CircleNode) {
  if (!node.children) {
    drawNode(ctx, node);
    return;
  }
  for (const child of node.children) drawTree(ctx, child);
}

function animateSplit(
  ctx: CanvasRenderingContext2D,
  parent: CircleNode,
  children: CircleNode[],
  onComplete: () => void
) {
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;
  const started = performance.now();
  const duration = reducedMotion ? 0 : 170;
  const parentX = parent.x + parent.w / 2;
  const parentY = parent.y + parent.h / 2;
  const parentRadius = nodeRadius(parent);
  let stopped = false;
  let completed = false;

  const finish = () => {
    if (completed) return;
    completed = true;
    ctx.clearRect(parent.x, parent.y, parent.w, parent.h);
    drawTree(ctx, parent);
    onComplete();
  };

  const frame = (now: number) => {
    if (stopped) return;
    const elapsed = duration === 0 ? duration : now - started;
    const overall = duration === 0 ? 1 : Math.min(1, elapsed / duration);
    const wave = 0.5 - Math.cos(overall * Math.PI) / 2;

    ctx.clearRect(parent.x, parent.y, parent.w, parent.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(parent.x, parent.y, parent.w, parent.h);
    ctx.clip();

    // Keep the old circle present briefly while the four children flow away
    // from its center. The cross-fade removes the stiff "pop" between levels.
    if (overall < 0.72) {
      ctx.globalAlpha = Math.max(0, 1 - overall / 0.72);
      drawNode(ctx, parent, 1 - wave * 0.08);
    }

    children.forEach((child, index) => {
      const delay = reducedMotion ? 0 : index * 7;
      const local =
        duration === 0
          ? 1
          : Math.min(1, Math.max(0, (elapsed - delay) / (duration - 18)));
      const eased = 0.5 - Math.cos(local * Math.PI) / 2;
      const targetX = child.x + child.w / 2;
      const targetY = child.y + child.h / 2;

      ctx.globalAlpha = Math.min(1, local * 1.65);
      drawNode(
        ctx,
        child,
        0.38 + eased * 0.62,
        parentX + (targetX - parentX) * eased,
        parentY + (targetY - parentY) * eased
      );
    });

    // A restrained expanding ring gives neighboring concurrent splits the
    // feeling of one continuous ripple along the pointer path.
    if (!reducedMotion && overall > 0.08 && overall < 0.9) {
      ctx.globalAlpha = Math.sin(overall * Math.PI) * 0.14;
      ctx.strokeStyle = rgbCss(parent.color);
      ctx.lineWidth = Math.max(1, parentRadius * 0.025);
      ctx.beginPath();
      ctx.arc(
        parentX,
        parentY,
        parentRadius * (0.35 + wave * 0.62),
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }

    ctx.restore();

    if (elapsed < duration + 28) requestAnimationFrame(frame);
    else finish();
  };

  requestAnimationFrame(frame);
  return () => {
    stopped = true;
    finish();
  };
}

function pointInsideNodeCircle(node: CircleNode, x: number, y: number) {
  const radius = nodeRadius(node);
  const dx = x - (node.x + node.w / 2);
  const dy = y - (node.y + node.h / 2);
  return dx * dx + dy * dy <= radius * radius;
}

function findLeaf(node: CircleNode, x: number, y: number): CircleNode | null {
  if (x < node.x || y < node.y || x >= node.x + node.w || y >= node.y + node.h) {
    return null;
  }
  if (!node.children) return pointInsideNodeCircle(node, x, y) ? node : null;

  for (const child of node.children) {
    if (
      x >= child.x &&
      y >= child.y &&
      x < child.x + child.w &&
      y < child.y + child.h
    ) {
      return findLeaf(child, x, y);
    }
  }
  return null;
}

function paletteFromImage(imageData: ImageData, k = 5): Palette {
  const pixels: RGB[] = [];
  const total = imageData.width * imageData.height;
  const step = Math.max(1, Math.floor(total / 10_000));

  for (let pixel = 0; pixel < total; pixel += step) {
    const i = pixel * 4;
    pixels.push([
      imageData.data[i],
      imageData.data[i + 1],
      imageData.data[i + 2]
    ]);
  }

  const centers: RGB[] = [pixels[Math.floor(pixels.length / 2)] || [128, 128, 128]];
  while (centers.length < k) {
    let best = pixels[0] || centers[0];
    let bestDistance = -1;
    for (const pixel of pixels) {
      const nearest = Math.min(
        ...centers.map((center) => {
          const dr = pixel[0] - center[0];
          const dg = pixel[1] - center[1];
          const db = pixel[2] - center[2];
          return dr * dr + dg * dg + db * db;
        })
      );
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = pixel;
      }
    }
    centers.push([...best] as RGB);
  }

  let counts = new Array(k).fill(0);
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const sums = Array.from({ length: k }, () => [0, 0, 0] as RGB);
    counts = new Array(k).fill(0);

    for (const pixel of pixels) {
      let closest = 0;
      let closestDistance = Number.POSITIVE_INFINITY;
      centers.forEach((center, index) => {
        const dr = pixel[0] - center[0];
        const dg = pixel[1] - center[1];
        const db = pixel[2] - center[2];
        const distance = dr * dr + dg * dg + db * db;
        if (distance < closestDistance) {
          closest = index;
          closestDistance = distance;
        }
      });
      sums[closest][0] += pixel[0];
      sums[closest][1] += pixel[1];
      sums[closest][2] += pixel[2];
      counts[closest] += 1;
    }

    centers.forEach((center, index) => {
      if (counts[index]) {
        center[0] = Math.round(sums[index][0] / counts[index]);
        center[1] = Math.round(sums[index][1] / counts[index]);
        center[2] = Math.round(sums[index][2] / counts[index]);
      }
    });
  }

  const ordered = centers
    .map((color, index) => ({ color, count: counts[index] }))
    .sort((a, b) => b.count - a.count)
    .map(({ color }) => rgbToHex(color));

  const unique = [...new Set(ordered)];
  const base = hexToRgb(unique[0] || "#808080");
  const variants = [
    base.map((v) => clamp(v * 0.72)) as RGB,
    base.map((v) => clamp(v + (255 - v) * 0.28)) as RGB,
    [clamp(base[0] + 18), clamp(base[1] - 12), clamp(base[2] + 8)] as RGB,
    [clamp(base[0] - 16), clamp(base[1] + 16), clamp(base[2] - 6)] as RGB
  ];

  for (const variant of variants) {
    const hex = rgbToHex(variant);
    if (!unique.includes(hex)) unique.push(hex);
    if (unique.length === k) break;
  }

  const colors = unique.slice(0, k);
  return { colors, textColor: bestTextColor(hexToRgb(colors[0])) };
}

function makeThumbnail(source: HTMLCanvasElement) {
  const scale = Math.min(1, 512 / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawPostcardMosaic(
  ctx: CanvasRenderingContext2D,
  integral: IntegralImage,
  panelX: number,
  panelY: number,
  panelW: number,
  panelH: number,
  background: string
) {
  const imageAspect = integral.width / integral.height;
  const inset = 22;
  const availableW = panelW - inset * 2;
  const availableH = panelH - inset * 2;

  let imageW = availableW;
  let imageH = imageW / imageAspect;
  if (imageH > availableH) {
    imageH = availableH;
    imageW = imageH * imageAspect;
  }

  const imageX = panelX + (panelW - imageW) / 2;
  const imageY = panelY + (panelH - imageH) / 2;

  const hashValue = (column: number, row: number, salt: number) => {
    const value = Math.abs(
      Math.sin((column + 13 + salt) * 12.9898 + (row + 5 + salt) * 78.233) *
        43758.5453
    );
    return value - Math.floor(value);
  };

  const sampleCell = (
    x: number,
    y: number,
    w: number,
    h: number
  ): RGB => {
    const sx = Math.max(
      0,
      Math.min(
        integral.width - 1,
        Math.floor(((x - imageX) / imageW) * integral.width)
      )
    );
    const sy = Math.max(
      0,
      Math.min(
        integral.height - 1,
        Math.floor(((y - imageY) / imageH) * integral.height)
      )
    );
    const sx2 = Math.max(
      sx + 1,
      Math.min(
        integral.width,
        Math.ceil(((x + w - imageX) / imageW) * integral.width)
      )
    );
    const sy2 = Math.max(
      sy + 1,
      Math.min(
        integral.height,
        Math.ceil(((y + h - imageY) / imageH) * integral.height)
      )
    );
    return regionAverage(integral, sx, sy, sx2 - sx, sy2 - sy);
  };

  const drawDot = (
    x: number,
    y: number,
    w: number,
    h: number,
    radiusScale: number
  ) => {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.max(
      0.35,
      Math.min(w, h) * 0.5 * Math.min(0.96, radiusScale)
    );
    ctx.fillStyle = rgbCss(sampleCell(x, y, w, h));
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawSubdividedCell = (
    x: number,
    y: number,
    w: number,
    h: number,
    depth: number,
    column: number,
    row: number
  ) => {
    if (depth <= 0) {
      drawDot(x, y, w, h, 0.82);
      return;
    }

    const halfW = w / 2;
    const halfH = h / 2;
    drawSubdividedCell(x, y, halfW, halfH, depth - 1, column * 2, row * 2);
    drawSubdividedCell(
      x + halfW,
      y,
      w - halfW,
      halfH,
      depth - 1,
      column * 2 + 1,
      row * 2
    );
    drawSubdividedCell(
      x,
      y + halfH,
      halfW,
      h - halfH,
      depth - 1,
      column * 2,
      row * 2 + 1
    );
    drawSubdividedCell(
      x + halfW,
      y + halfH,
      w - halfW,
      h - halfH,
      depth - 1,
      column * 2 + 1,
      row * 2 + 1
    );
  };

  ctx.save();
  roundedRect(ctx, panelX, panelY, panelW, panelH, 52);
  ctx.clip();
  ctx.fillStyle = background;
  ctx.fillRect(panelX, panelY, panelW, panelH);

  /*
   * One aligned base grid drives every size tier. Only the outer two base
   * layers remain coarse; the next two layers are quartered once, and the
   * large center is quartered twice. This preserves orderly alignment while
   * giving most of the photo a smaller, more detailed dot matrix.
   */
  const basePitch = 18;
  const columns = Math.max(1, Math.ceil(imageW / basePitch));
  const rows = Math.max(1, Math.ceil(imageH / basePitch));
  const stepX = imageW / columns;
  const stepY = imageH / rows;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = imageX + column * stepX;
      const y = imageY + row * stepY;
      const ring = Math.min(
        column,
        row,
        columns - 1 - column,
        rows - 1 - row
      );

      if (ring <= 1) {
        // The two outer layers stay orderly but vary subtly in diameter.
        const variation = 0.82 + hashValue(column, row, 17) * 0.12;
        drawDot(x, y, stepX, stepY, variation);
      } else if (ring <= 3) {
        // The next two layers are smaller and use much less variation.
        const halfW = stepX / 2;
        const halfH = stepY / 2;
        for (let subRow = 0; subRow < 2; subRow += 1) {
          for (let subColumn = 0; subColumn < 2; subColumn += 1) {
            const variation =
              0.82 + hashValue(column * 2 + subColumn, row * 2 + subRow, 31) * 0.07;
            drawDot(
              x + subColumn * halfW,
              y + subRow * halfH,
              halfW,
              halfH,
              variation
            );
          }
        }
      } else {
        // Most of the panel uses a dense, uniform 4×4 subdivision.
        drawSubdividedCell(x, y, stepX, stepY, 2, column, row);
      }
    }
  }

  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,.72)";
  ctx.lineWidth = 10;
  roundedRect(ctx, panelX, panelY, panelW, panelH, 52);
  ctx.stroke();
  ctx.restore();
}

function drawPostcard(
  canvas: HTMLCanvasElement,
  source: HTMLCanvasElement,
  integral: IntegralImage,
  palette: Palette,
  quote: string,
  loading: boolean,
  themeKey: ThemeKey
) {
  canvas.width = EXPORT_W;
  canvas.height = EXPORT_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const colors = palette.colors.length ? palette.colors : ["#d8c7b2", "#78909c"];
  const theme = resolvePostcardTheme(palette, themeKey);
  const gradient = ctx.createLinearGradient(0, 0, EXPORT_W, EXPORT_H);
  gradient.addColorStop(0, theme.background[0]);
  gradient.addColorStop(0.58, theme.background[1] || theme.background[0]);
  gradient.addColorStop(1, theme.background[2] || theme.background[0]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);

  ctx.fillStyle = theme.paper;
  roundedRect(ctx, 54, 54, EXPORT_W - 108, EXPORT_H - 108, 64);
  ctx.fill();

  drawPostcardMosaic(
    ctx,
    integral,
    92,
    104,
    790,
    1032,
    theme.panel
  );

  ctx.fillStyle = colors[0];
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(1000, 184, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(1038, 184, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(1068, 184, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const displayQuote = loading ? "writing your quote…" : quote;
  const textColor = theme.ink;
  let fontSize = loading ? 44 : 54;
  let lines: string[] = [];
  do {
    ctx.font = `500 ${fontSize}px Georgia, "Times New Roman", serif`;
    lines = wrapText(ctx, displayQuote, 650);
    if (lines.length <= 5) break;
    fontSize -= 3;
  } while (fontSize >= 36);

  ctx.fillStyle = textColor;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const lineHeight = fontSize * 1.34;
  const quoteX = 980;
  const quoteCenterY = 610;
  const startY = quoteCenterY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    ctx.fillText(line, quoteX, startY + index * lineHeight);
  });

  ctx.fillStyle = colors[0];
  ctx.globalAlpha = 0.72;
  ctx.fillRect(quoteX, startY - lineHeight, 96, 5);
  ctx.globalAlpha = 1;

  ctx.fillStyle = theme.muted;
  ctx.font = "500 22px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.letterSpacing = "5px";
  ctx.fillText("A MOMENT WORTH KEEPING", quoteX, 935);

  ctx.fillStyle = theme.muted;
  ctx.font = "600 24px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.letterSpacing = "7px";
  ctx.fillText("SCRATCHIT", quoteX, 1070);
  ctx.letterSpacing = "0px";

  ctx.globalAlpha = 0.5;
  colors.slice(0, 4).forEach((color, index) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(1542 + index * 28, 1066, 8 - index, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  void source;
}

function downloadCanvas(canvas: HTMLCanvasElement) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "scratchit-postcard.png";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("upload");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [quote, setQuote] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [revealSession, setRevealSession] = useState(0);
  const [revealingAll, setRevealingAll] = useState(false);
  const [themeKey, setThemeKey] = useState<ThemeKey>("photo");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const revealCanvasRef = useRef<HTMLCanvasElement>(null);
  const postcardCanvasRef = useRef<HTMLCanvasElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const integralRef = useRef<IntegralImage | null>(null);
  const paletteRef = useRef<Palette | null>(null);
  const rootRef = useRef<CircleNode | null>(null);
  const initialGridRef = useRef<[number, number]>([3, 2]);
  const activeSplitCancelsRef = useRef(new Map<CircleNode, () => void>());
  const resolvedAreaRef = useRef(0);
  const progressScoreRef = useRef(0);
  const maxRevealDepthRef = useRef(1);
  const totalAreaRef = useRef(1);
  const fullyRevealedRef = useRef(false);
  const splitAnimatingRef = useRef(false);
  const revealRunRef = useRef(0);
  const quoteAbortRef = useRef<AbortController | null>(null);

  const openPostcard = useCallback(() => {
    if (
      !sourceCanvasRef.current ||
      !paletteRef.current ||
      !fullyRevealedRef.current
    ) {
      return;
    }
    setScreen("postcard");
    setQuote("");
  }, []);

  const resetReveal = useCallback(() => {
    const source = sourceCanvasRef.current;
    const integral = integralRef.current;
    const canvas = revealCanvasRef.current;
    if (!source || !integral || !canvas) return;

    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    for (const cancel of [...activeSplitCancelsRef.current.values()]) cancel();
    activeSplitCancelsRef.current.clear();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const root = createInitialRoot(integral, ...initialGridRef.current);
    rootRef.current = root;
    fullyRevealedRef.current = false;
    splitAnimatingRef.current = false;
    setRevealingAll(false);
    totalAreaRef.current = source.width * source.height;
    maxRevealDepthRef.current = Math.max(
      1,
      Math.ceil(
        Math.log2(Math.max(1, Math.min(source.width, source.height) / FINAL_CELL))
      )
    );

    const leaves = root.children || [root];
    resolvedAreaRef.current = leaves.reduce(
      (sum, node) => sum + (terminal(node) ? node.w * node.h : 0),
      0
    );
    progressScoreRef.current = leaves.reduce(
      (sum, node) =>
        sum +
        node.w *
          node.h *
          resolutionFraction(node, maxRevealDepthRef.current),
      0
    );

    for (const node of leaves) drawNode(ctx, node);

    const fullyResolved = resolvedAreaRef.current >= totalAreaRef.current;
    setProgress(
      fullyResolved
        ? 100
        : Math.min(
            99,
            Math.round((progressScoreRef.current / totalAreaRef.current) * 100)
          )
    );
  }, []);

  useEffect(() => {
    if (screen === "reveal") {
      requestAnimationFrame(resetReveal);
    }
  }, [screen, revealSession, resetReveal]);

  const processFile = useCallback(async (file: File) => {
    setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("That file isn't a supported image.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("That photo is over 20 MB. Please choose a smaller image.");
      return;
    }

    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image"
      });
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const scaledWidth = Math.max(1, Math.round(bitmap.width * scale));
      const scaledHeight = Math.max(1, Math.round(bitmap.height * scale));
      const [gridColumns, gridRows] = initialGrid(scaledWidth, scaledHeight);
      initialGridRef.current = [gridColumns, gridRows];
      const rawCellSize = Math.max(
        FINAL_CELL,
        Math.floor(Math.min(scaledWidth / gridColumns, scaledHeight / gridRows))
      );
      // Keep both canvas dimensions divisible by the final pitch so equal,
      // tangent circles tile the complete reveal without edge clipping.
      const cellSize = Math.max(
        FINAL_CELL,
        Math.floor(rawCellSize / FINAL_CELL) * FINAL_CELL
      );
      const width = gridColumns * cellSize;
      const height = gridRows * cellSize;
      const source = document.createElement("canvas");
      source.width = width;
      source.height = height;
      const ctx = source.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas is unavailable.");

      // Fit rather than crop: every source pixel remains visible. The small
      // letterbox needed to make square root cells is composited to white.
      const containScale = Math.min(width / bitmap.width, height / bitmap.height);
      const drawWidth = bitmap.width * containScale;
      const drawHeight = bitmap.height * containScale;
      const drawX = (width - drawWidth) / 2;
      const drawY = (height - drawHeight) / 2;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, drawX, drawY, drawWidth, drawHeight);
      bitmap.close();

      const imageData = ctx.getImageData(0, 0, width, height);
      sourceCanvasRef.current = source;
      integralRef.current = buildIntegral(imageData);
      paletteRef.current = paletteFromImage(imageData);
      setProgress(0);
      setThemeKey("photo");
      setRevealSession((value) => value + 1);
      setScreen("reveal");
    } catch {
      setError("We couldn't read that image. Please try another JPG, PNG, or WebP.");
    } finally {
      setBusy(false);
    }
  }, []);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void processFile(file);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void processFile(file);
  };

  const splitAtPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (
      screen !== "reveal" ||
      fullyRevealedRef.current ||
      revealingAll
    ) {
      return;
    }
    if (event.pointerType === "touch" && event.type === "pointermove") return;

    const canvas = revealCanvasRef.current;
    const integral = integralRef.current;
    const root = rootRef.current;
    if (!canvas || !integral || !root) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const leaf = findLeaf(root, x, y);
    if (!leaf || leaf.children || terminal(leaf)) return;

    // If this leaf belongs to a still-animating parent, settle that parent
    // immediately. Splits on neighboring branches continue concurrently.
    let ancestor = leaf.parent;
    while (ancestor) {
      activeSplitCancelsRef.current.get(ancestor)?.();
      ancestor = ancestor.parent;
    }

    const regions = childRegions(leaf);
    leaf.children = regions.map(([cx, cy, cw, ch]) =>
      createNode(integral, cx, cy, cw, ch, leaf.level + 1, leaf)
    );

    const previousScore =
      leaf.w *
      leaf.h *
      resolutionFraction(leaf, maxRevealDepthRef.current);
    const childScore = leaf.children.reduce(
      (sum, child) =>
        sum +
        child.w *
          child.h *
          resolutionFraction(child, maxRevealDepthRef.current),
      0
    );
    progressScoreRef.current += childScore - previousScore;

    for (const child of leaf.children) {
      if (terminal(child)) resolvedAreaRef.current += child.w * child.h;
    }

    const fullyResolved = resolvedAreaRef.current >= totalAreaRef.current;
    const nextProgress = fullyResolved
      ? 100
      : Math.min(
          99,
          Math.round((progressScoreRef.current / totalAreaRef.current) * 100)
        );
    setProgress(nextProgress);
    if (fullyResolved) fullyRevealedRef.current = true;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cancel = animateSplit(ctx, leaf, leaf.children, () => {
      activeSplitCancelsRef.current.delete(leaf);
      if (fullyResolved) drawFinalMosaic(ctx, integral);
    });
    activeSplitCancelsRef.current.set(leaf, cancel);
  };

  const revealAll = () => {
    const canvas = revealCanvasRef.current;
    const integral = integralRef.current;
    if (!canvas || !integral || revealingAll) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    for (const cancel of [...activeSplitCancelsRef.current.values()]) cancel();
    activeSplitCancelsRef.current.clear();

    const run = ++revealRunRef.current;
    const dots = createFinalDots(integral);
    const centerX = integral.width / 2;
    const centerY = integral.height / 2;
    dots.sort((a, b) => {
      const distanceA = Math.hypot(
        (a.cx - centerX) / integral.width,
        (a.cy - centerY) / integral.height
      );
      const distanceB = Math.hypot(
        (b.cx - centerX) / integral.width,
        (b.cy - centerY) / integral.height
      );
      return distanceA - distanceB;
    });

    const totalDots = dots.length;
    const startProgress = progress;
    const started = performance.now();
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 720;
    let index = 0;

    setRevealingAll(true);
    splitAnimatingRef.current = true;

    const paintBatch = (now: number) => {
      if (run !== revealRunRef.current || screen !== "reveal") return;

      const linear =
        duration === 0 ? 1 : Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - linear, 2.2);
      const targetIndex = Math.min(
        totalDots,
        Math.max(index + 1, Math.ceil(totalDots * eased))
      );

      // Dots are ordered from the center outward, producing a quick spreading
      // refinement wave rather than a rigid row-by-row wipe.
      for (; index < targetIndex; index += 1) {
        const dot = dots[index];
        ctx.clearRect(dot.x, dot.y, dot.w, dot.h);
        ctx.fillStyle = rgbCss(dot.color);
        ctx.beginPath();
        ctx.arc(dot.cx, dot.cy, dot.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      const fraction = totalDots ? index / totalDots : 1;
      setProgress(
        Math.min(
          99,
          Math.max(
            startProgress,
            Math.round(startProgress + (100 - startProgress) * fraction)
          )
        )
      );

      if (index < totalDots) {
        requestAnimationFrame(paintBatch);
        return;
      }

      drawFinalMosaic(ctx, integral);
      fullyRevealedRef.current = true;
      resolvedAreaRef.current = totalAreaRef.current;
      progressScoreRef.current = totalAreaRef.current;
      splitAnimatingRef.current = false;
      setProgress(100);
      setRevealingAll(false);
    };

    requestAnimationFrame(paintBatch);
  };

  const requestQuote = useCallback(async () => {
    const source = sourceCanvasRef.current;
    const palette = paletteRef.current;
    if (!source || !palette) return;

    quoteAbortRef.current?.abort();
    const controller = new AbortController();
    quoteAbortRef.current = controller;
    setQuoteLoading(true);

    try {
      const response = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          thumbnail: makeThumbnail(source),
          palette: palette.colors
        })
      });
      const data = await response.json();
      const next =
        typeof data?.quote === "string" && data.quote.trim()
          ? data.quote.trim()
          : FALLBACK_QUOTES[Math.floor(Math.random() * FALLBACK_QUOTES.length)];
      setQuote(next);
    } catch (requestError) {
      if ((requestError as Error).name !== "AbortError") {
        setQuote(
          FALLBACK_QUOTES[Math.floor(Math.random() * FALLBACK_QUOTES.length)]
        );
      }
    } finally {
      if (quoteAbortRef.current === controller) setQuoteLoading(false);
    }
  }, []);

  useEffect(() => {
    if (screen === "postcard") void requestQuote();
    return () => {
      quoteAbortRef.current?.abort();
    };
  }, [screen, requestQuote]);

  useEffect(() => {
    if (
      screen === "postcard" &&
      postcardCanvasRef.current &&
      sourceCanvasRef.current &&
      paletteRef.current
    ) {
      drawPostcard(
        postcardCanvasRef.current,
        sourceCanvasRef.current,
        integralRef.current!,
        paletteRef.current,
        quote || FALLBACK_QUOTES[0],
        quoteLoading,
        themeKey
      );
    }
  }, [screen, quote, quoteLoading, themeKey]);

  const startOver = () => {
    for (const cancel of [...activeSplitCancelsRef.current.values()]) cancel();
    activeSplitCancelsRef.current.clear();
    revealRunRef.current += 1;
    setRevealingAll(false);
    setProgress(0);
    setRevealSession((value) => value + 1);
    setScreen("reveal");
  };

  const newPhoto = () => {
    for (const cancel of [...activeSplitCancelsRef.current.values()]) cancel();
    activeSplitCancelsRef.current.clear();
    revealRunRef.current += 1;
    setRevealingAll(false);
    quoteAbortRef.current?.abort();
    sourceCanvasRef.current = null;
    integralRef.current = null;
    paletteRef.current = null;
    rootRef.current = null;
    setError("");
    setProgress(0);
    setQuote("");
    setThemeKey("photo");
    setScreen("upload");
  };

  const buttonClass =
    "focus-ring rounded-full border border-stone-300 bg-white/90 px-5 py-2.5 text-sm font-semibold text-stone-800 shadow-sm transition hover:-translate-y-0.5 hover:border-stone-500 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50";

  if (screen === "upload") {
    return (
      <main className="screen-enter flex min-h-[100dvh] items-center justify-center px-5 py-10">
        <section className="w-full max-w-3xl text-center">
          <div className="mb-10">
            <p className="mb-3 text-sm font-bold tracking-[0.28em] text-stone-500">
              SCRATCHIT
            </p>
            <h1 className="font-serif text-5xl font-semibold tracking-tight text-stone-900 sm:text-7xl">
              reveal a memory
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-stone-600 sm:text-lg">
              Turn a favorite photo into a tactile circle mosaic, then keep the
              moment as a one-of-a-kind postcard.
            </p>
          </div>

          <div
            role="button"
            tabIndex={0}
            aria-label="Upload a photo. Drag a photo here, or press Enter to browse."
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`focus-ring checker cursor-pointer rounded-[2rem] border-2 border-dashed p-5 transition ${
              dragging
                ? "scale-[1.01] border-stone-700"
                : "border-stone-300 hover:border-stone-500"
            }`}
          >
            <div className="rounded-[1.45rem] bg-white/90 px-6 py-20 shadow-soft backdrop-blur">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-stone-900 text-3xl text-white">
                +
              </div>
              <p className="text-lg font-semibold text-stone-900">
                {busy ? "preparing your photo…" : "Drag a photo here, or click to browse"}
              </p>
              <p className="mt-2 text-sm text-stone-500">
                JPG, PNG, or WebP · up to 20 MB
              </p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onFileChange}
            disabled={busy}
          />
          {error && (
            <p role="alert" className="mt-5 text-sm font-medium text-red-700">
              {error}
            </p>
          )}
          <p className="mt-10 text-xs text-stone-400">
            Your full-resolution photo stays in your browser.
          </p>
        </section>
      </main>
    );
  }

  if (screen === "reveal") {
    return (
      <main className="screen-enter flex min-h-[100dvh] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <button
            className="focus-ring text-sm font-bold tracking-[0.22em] text-stone-800"
            onClick={newPhoto}
          >
            SCRATCHIT
          </button>
          <div className="min-w-32 text-right">
            <p className="text-sm font-semibold text-stone-800">
              {progress}% revealed
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200">
              <div
                className="h-full rounded-full bg-stone-900 transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </header>

        <section className="relative flex min-h-0 flex-1 items-center justify-center px-4 py-2">
          <div className="checker flex h-full max-h-[calc(100dvh-9.5rem)] w-full max-w-6xl items-center justify-center overflow-hidden rounded-[2rem] border border-stone-200 p-3 shadow-soft sm:p-5">
            <canvas
              ref={revealCanvasRef}
              onPointerMove={splitAtPointer}
              onPointerDown={splitAtPointer}
              className="block h-auto w-auto max-w-full touch-none [max-height:calc(100dvh-10.5rem)]"
              aria-label="Interactive photo reveal. Move the pointer across colored circles to split them into smaller circles. Use Reveal all for a keyboard-accessible alternative."
            />
          </div>
        </section>

        <footer className="flex min-h-[4.25rem] shrink-0 flex-wrap items-center justify-center gap-3 px-5 py-3">
          <button
            className={buttonClass}
            onClick={revealAll}
            disabled={revealingAll || progress === 100}
          >
            {revealingAll ? "Revealing…" : progress === 100 ? "Fully revealed" : "Reveal all"}
          </button>
          {progress === 100 && !revealingAll && (
            <button
              className="primary-button focus-ring screen-enter rounded-full px-5 py-2.5 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              onClick={openPostcard}
            >
              Generate postcard
            </button>
          )}
          <button className={buttonClass} onClick={newPhoto}>
            New photo
          </button>
        </footer>
      </main>
    );
  }

  return (
    <main className="screen-enter flex min-h-[100dvh] flex-col px-5 py-5 sm:px-8">
      <header className="flex items-center justify-between">
        <button
          className="focus-ring text-sm font-bold tracking-[0.22em] text-stone-800"
          onClick={newPhoto}
        >
          SCRATCHIT
        </button>
        <p aria-live="polite" className="text-sm text-stone-500">
          {quoteLoading ? "writing your quote…" : "your postcard is ready"}
        </p>
      </header>

      <section className="flex flex-1 items-center justify-center py-6">
        <div className="w-full max-w-5xl overflow-hidden rounded-[1.6rem] bg-white p-2 shadow-soft sm:p-3">
          <canvas
            ref={postcardCanvasRef}
            className="block h-auto w-full rounded-[1.15rem]"
            aria-label={`Generated scratchit postcard. ${
              quoteLoading ? "Writing your quote." : quote
            }`}
          />
        </div>
      </section>

      <div
        className="mb-4 flex flex-wrap items-center justify-center gap-2"
        role="group"
        aria-label="Postcard color theme"
      >
        <span className="mr-1 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
          Color theme
        </span>
        {THEME_OPTIONS.map((option) => {
          const swatches =
            option.key === "photo"
              ? paletteRef.current?.colors.slice(0, 3) || ["#b7a99d", "#d9cec2", "#6d7477"]
              : option.swatches;
          const selected = themeKey === option.key;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={selected}
              className={`focus-ring flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${
                selected
                  ? "border-stone-800 bg-stone-900 text-white shadow-sm"
                  : "border-stone-300 bg-white/90 text-stone-700 hover:border-stone-500"
              }`}
              onClick={() => setThemeKey(option.key)}
            >
              <span className="flex -space-x-1" aria-hidden="true">
                {swatches.map((color, index) => (
                  <span
                    key={`${color}-${index}`}
                    className="h-3.5 w-3.5 rounded-full border border-white/70"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
              {option.label}
            </button>
          );
        })}
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-3">
        <button
          className={buttonClass}
          onClick={() => void requestQuote()}
          disabled={quoteLoading}
        >
          New quote
        </button>
        <button
          className="primary-button focus-ring rounded-full px-5 py-2.5 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            if (postcardCanvasRef.current) downloadCanvas(postcardCanvasRef.current);
          }}
          disabled={quoteLoading}
        >
          Download PNG
        </button>
        <button className={buttonClass} onClick={startOver}>
          Start over
        </button>
        <button className={buttonClass} onClick={newPhoto}>
          New photo
        </button>
      </footer>
    </main>
  );
}
