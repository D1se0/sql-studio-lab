/** Disposición del mapa de esquema: fuerza dirigida determinista y sin dependencias.
 *
 *  Cada tabla es una tarjeta rectangular. Las claves foráneas actúan como
 *  muelles, todas las tarjetas se repelen y una gravedad suave las centra.
 *  Trabaja en coordenadas "de mundo"; el componente se encarga del zoom y pan.
 */

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface Point {
  x: number;
  y: number;
}

/** PRNG pequeño y reproducible: el mismo esquema produce siempre el mismo mapa. */
function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Record<string, Point> {
  if (nodes.length === 0) return {};

  const random = seededRandom(hash(nodes.map((node) => node.id).sort().join("|")));
  const degree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  const count = nodes.length;
  const radius = Math.max(240, Math.sqrt(count) * 135);
  const positions = new Map<string, Point>();

  // Los nodos con más relaciones van al centro; el resto, en dos anillos.
  const ordered = [...nodes].sort(
    (a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id),
  );
  ordered.forEach((node, index) => {
    const angle = (index / count) * Math.PI * 2 + random() * 0.35;
    const ring = index < 4 ? radius * 0.45 : radius;
    positions.set(node.id, {
      x: Math.cos(angle) * ring + (random() - 0.5) * 60,
      y: Math.sin(angle) * ring + (random() - 0.5) * 60,
    });
  });

  const padding = 20;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const iterations = count > 60 ? 140 : 300;
  const springLength = 300;
  const repulsion = 4.5;

  for (let step = 0; step < iterations; step += 1) {
    const alpha = 1 - step / iterations;
    const forces = new Map<string, Point>();
    for (const node of nodes) forces.set(node.id, { x: 0, y: 0 });

    // Repulsión entre tarjetas (incluye su tamaño para no solaparse).
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const pa = positions.get(a.id)!;
        const pb = positions.get(b.id)!;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const distance = Math.max(60, Math.hypot(dx, dy));
        const reach = 180 + (a.width + b.width) / 4;
        const strength = (reach * reach) / (distance * distance);
        const fx = (dx / distance) * strength * repulsion * alpha;
        const fy = (dy / distance) * strength * repulsion * alpha;
        const fa = forces.get(a.id)!;
        const fb = forces.get(b.id)!;
        fa.x -= fx;
        fa.y -= fy;
        fb.x += fx;
        fb.y += fy;
      }
    }

    // Muelles de las claves foráneas.
    for (const edge of edges) {
      const pa = positions.get(edge.from);
      const pb = positions.get(edge.to);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const distance = Math.max(40, Math.hypot(dx, dy));
      const stretch = (distance - springLength) * 0.05 * alpha;
      const fx = (dx / distance) * stretch;
      const fy = (dy / distance) * stretch;
      forces.get(edge.from)!.x += fx;
      forces.get(edge.from)!.y += fy;
      forces.get(edge.to)!.x -= fx;
      forces.get(edge.to)!.y -= fy;
    }

    // Gravedad suave hacia el origen.
    for (const node of nodes) {
      const point = positions.get(node.id)!;
      forces.get(node.id)!.x -= point.x * 0.024;
      forces.get(node.id)!.y -= point.y * 0.024;
    }

    for (const node of nodes) {
      const point = positions.get(node.id)!;
      const force = forces.get(node.id)!;
      point.x += Math.max(-18, Math.min(18, force.x));
      point.y += Math.max(-18, Math.min(18, force.y));
    }

    // Resolución de solapes entre rectángulos.
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const a = byId.get(nodes[i].id)!;
        const b = byId.get(nodes[j].id)!;
        const pa = positions.get(a.id)!;
        const pb = positions.get(b.id)!;
        const overlapX =
          a.width / 2 + b.width / 2 + padding - Math.abs(pb.x - pa.x);
        const overlapY =
          a.height / 2 + b.height / 2 + padding - Math.abs(pb.y - pa.y);
        if (overlapX > 0 && overlapY > 0) {
          const push = Math.min(overlapX, overlapY) * 0.24;
          if (overlapX < overlapY) {
            const sign = pb.x >= pa.x ? 1 : -1;
            pa.x -= push * sign;
            pb.x += push * sign;
          } else {
            const sign = pb.y >= pa.y ? 1 : -1;
            pa.y -= push * sign;
            pb.y += push * sign;
          }
        }
      }
    }
  }

  // Compacta si el grafo se ha estirado: 6 tarjetas por fila como máximo.
  let centerX = 0;
  let centerY = 0;
  for (const node of nodes) {
    const point = positions.get(node.id)!;
    centerX += point.x;
    centerY += point.y;
  }
  centerX /= count;
  centerY /= count;
  let spanX = 0;
  let spanY = 0;
  for (const node of nodes) {
    const point = positions.get(node.id)!;
    spanX = Math.max(spanX, Math.abs(point.x - centerX) * 2 + node.width);
    spanY = Math.max(spanY, Math.abs(point.y - centerY) * 2 + node.height);
  }
  const target = Math.max(820, Math.sqrt(count) * 330);
  const scale = Math.min(1, target / Math.max(spanX, spanY));
  if (scale < 0.999) {
    for (const node of nodes) {
      const point = positions.get(node.id)!;
      point.x = centerX + (point.x - centerX) * scale;
      point.y = centerY + (point.y - centerY) * scale;
    }
  }

  // Separación final de rectángulos: deja respirar sin volver a inflar el mapa.
  for (let pass = 0; pass < 90; pass += 1) {
    let moved = false;
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const pa = positions.get(a.id)!;
        const pb = positions.get(b.id)!;
        const overlapX = a.width / 2 + b.width / 2 + padding - Math.abs(pb.x - pa.x);
        const overlapY = a.height / 2 + b.height / 2 + padding - Math.abs(pb.y - pa.y);
        if (overlapX > 0 && overlapY > 0) {
          moved = true;
          const push = Math.min(overlapX, overlapY) * 0.5 + 0.5;
          if (overlapX < overlapY) {
            const sign = pb.x >= pa.x ? 1 : -1;
            pa.x -= push * sign;
            pb.x += push * sign;
          } else {
            const sign = pb.y >= pa.y ? 1 : -1;
            pa.y -= push * sign;
            pb.y += push * sign;
          }
        }
      }
    }
    if (!moved) break;
  }

  // Normaliza para que todo quede en positivo con margen.
  let minX = Infinity;
  let minY = Infinity;
  for (const node of nodes) {
    const point = positions.get(node.id)!;
    const width = node.width / 2;
    const height = node.height / 2;
    minX = Math.min(minX, point.x - width);
    minY = Math.min(minY, point.y - height);
  }
  const offsetX = 80 - minX;
  const offsetY = 80 - minY;
  const result: Record<string, Point> = {};
  for (const node of nodes) {
    const point = positions.get(node.id)!;
    result[node.id] = { x: point.x + offsetX, y: point.y + offsetY };
  }
  return result;
}

/** Punto de anclaje en el borde de una tarjeta, mirando hacia el destino. */
export function anchor(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number },
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return { x: from.x + (dx >= 0 ? from.width / 2 : -from.width / 2), y: from.y };
  }
  return { x: from.x, y: from.y + (dy >= 0 ? from.height / 2 : -from.height / 2) };
}

export function edgePath(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): string {
  const start = anchor(a, b);
  const end = anchor(b, a);
  const horizontal = Math.abs(end.x - start.x) > Math.abs(end.y - start.y);
  if (horizontal) {
    const bend = Math.max(50, Math.abs(end.x - start.x) * 0.45);
    const control = end.x >= start.x ? bend : -bend;
    return `M ${start.x} ${start.y} C ${start.x + control} ${start.y}, ${end.x - control} ${end.y}, ${end.x} ${end.y}`;
  }
  const bend = Math.max(50, Math.abs(end.y - start.y) * 0.45);
  const control = end.y >= start.y ? bend : -bend;
  return `M ${start.x} ${start.y} C ${start.x} ${start.y + control}, ${end.x} ${end.y - control}, ${end.x} ${end.y}`;
}

export function nodeHeight(columnCount: number, showColumns: boolean): number {
  if (!showColumns) return 44;
  return 38 + Math.min(columnCount, 5) * 18 + (columnCount > 5 ? 16 : 0);
}
