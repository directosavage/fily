export interface Point {
  x: number;
  y: number;
}

export type Homography = readonly [number, number, number, number, number, number, number, number, number];
export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function solveLinearSystem(matrix: number[][], values: number[]): number[] {
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < 8; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 8; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) throw new Error('The selected corners do not form a valid page.');
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let cell = column; cell <= 8; cell += 1) rows[column][cell] /= divisor;
    for (let row = 0; row < 8; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let cell = column; cell <= 8; cell += 1) rows[row][cell] -= factor * rows[column][cell];
    }
  }
  return rows.map((row) => row[8]);
}

export function homographyFromPoints(source: readonly Point[], target: readonly Point[]): Homography {
  if (source.length !== 4 || target.length !== 4) throw new Error('A perspective transform needs four corners.');
  const matrix: number[][] = [];
  const values: number[] = [];
  source.forEach(({ x, y }, index) => {
    const { x: u, y: v } = target[index];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  });
  const [a, b, c, d, e, f, g, h] = solveLinearSystem(matrix, values);
  return [a, b, c, d, e, f, g, h, 1];
}

export function mapPoint(matrix: Homography, point: Point): Point {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const divisor = g * point.x + h * point.y + i;
  return {
    x: (a * point.x + b * point.y + c) / divisor,
    y: (d * point.x + e * point.y + f) / divisor,
  };
}

export function warpPerspective(
  source: PixelImage,
  corners: readonly [Point, Point, Point, Point],
  outputWidth: number,
  outputHeight: number,
): PixelImage {
  const destination: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: outputWidth - 1, y: 0 },
    { x: outputWidth - 1, y: outputHeight - 1 },
    { x: 0, y: outputHeight - 1 },
  ];
  const inverse = homographyFromPoints(destination, corners);
  const data = new Uint8ClampedArray(outputWidth * outputHeight * 4);

  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const { x: sx, y: sy } = mapPoint(inverse, { x, y });
      const targetIndex = (y * outputWidth + x) * 4;
      if (sx < 0 || sy < 0 || sx > source.width - 1 || sy > source.height - 1) {
        data[targetIndex + 3] = 255;
        continue;
      }
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, source.width - 1);
      const y1 = Math.min(y0 + 1, source.height - 1);
      const tx = sx - x0;
      const ty = sy - y0;
      const topLeft = (y0 * source.width + x0) * 4;
      const topRight = (y0 * source.width + x1) * 4;
      const bottomLeft = (y1 * source.width + x0) * 4;
      const bottomRight = (y1 * source.width + x1) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = source.data[topLeft + channel] * (1 - tx) + source.data[topRight + channel] * tx;
        const bottom =
          source.data[bottomLeft + channel] * (1 - tx) + source.data[bottomRight + channel] * tx;
        data[targetIndex + channel] = Math.round(top * (1 - ty) + bottom * ty);
      }
    }
  }
  return { width: outputWidth, height: outputHeight, data };
}
