"use client";

import { useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { WsContext } from "@/components/ws-provider/ws-provider";

// ── Simulation types ──────────────────────────────────────────────────────────

interface SimNode {
  id: string;
  label: string;
  role?: string;
  online: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
}

interface SimEdge {
  source: string;
  target: string;
  weight: number;
}

// ── Color palette ─────────────────────────────────────────────────────────────

const C = {
  bg: "#020c1b",
  grid: "rgba(26,51,86,0.4)",
  nodeOnline: "#00d4ff",
  nodeOffline: "#1a3356",
  nodeOnlineFill: "rgba(0,212,255,0.12)",
  nodeOfflineFill: "rgba(26,51,86,0.3)",
  nodeHover: "#4de8ff",
  nodeSelected: "#ff6b6b",
  edgeDefault: "rgba(0,212,255,0.18)",
  edgeHot: "rgba(0,212,255,0.7)",
  edgeSelected: "rgba(255,107,107,0.6)",
  label: "#6b8aaa",
  labelOnline: "#c8d8e8",
  labelRole: "#00d4ff",
  tooltip: {
    bg: "rgba(7,15,30,0.95)",
    border: "#1a3356",
    text: "#c8d8e8",
    dim: "#3a5470",
  },
};

// ── Force simulation ──────────────────────────────────────────────────────────

const REPULSION = 4500;
const ATTRACTION = 0.03;
const GRAVITY = 0.008;
const DAMPING = 0.82;
const MIN_DIST = 60;
const NODE_RADIUS = 18;

function tick(
  nodes: SimNode[],
  edges: SimEdge[],
  cx: number,
  cy: number,
  w: number,
  h: number,
): void {
  const idxMap = new Map(nodes.map((n, i) => [n.id, i]));

  // Reset accumulated forces
  const fx = new Float64Array(nodes.length);
  const fy = new Float64Array(nodes.length);

  // Gravity toward center
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].pinned) continue;
    fx[i] += (cx - nodes[i].x) * GRAVITY;
    fy[i] += (cy - nodes[i].y) * GRAVITY;
  }

  // Repulsion between all node pairs
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      const dist2 = Math.max(dx * dx + dy * dy, MIN_DIST * MIN_DIST);
      const dist = Math.sqrt(dist2);
      const force = REPULSION / dist2;
      const fdx = (dx / dist) * force;
      const fdy = (dy / dist) * force;
      if (!nodes[i].pinned) { fx[i] -= fdx; fy[i] -= fdy; }
      if (!nodes[j].pinned) { fx[j] += fdx; fy[j] += fdy; }
    }
  }

  // Spring attraction along edges
  for (const edge of edges) {
    const si = idxMap.get(edge.source);
    const ti = idxMap.get(edge.target);
    if (si === undefined || ti === undefined) continue;
    const dx = nodes[ti].x - nodes[si].x;
    const dy = nodes[ti].y - nodes[si].y;
    const strength = ATTRACTION * Math.log1p(edge.weight);
    if (!nodes[si].pinned) { fx[si] += dx * strength; fy[si] += dy * strength; }
    if (!nodes[ti].pinned) { fx[ti] -= dx * strength; fy[ti] -= dy * strength; }
  }

  // Integrate velocities and clamp to canvas bounds
  const pad = NODE_RADIUS + 10;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].pinned) continue;
    nodes[i].vx = (nodes[i].vx + fx[i]) * DAMPING;
    nodes[i].vy = (nodes[i].vy + fy[i]) * DAMPING;
    nodes[i].x = Math.max(pad, Math.min(w - pad, nodes[i].x + nodes[i].vx));
    nodes[i].y = Math.max(pad, Math.min(h - pad, nodes[i].y + nodes[i].vy));
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function shortLabel(instanceId: string): string {
  // "username@host:project/uuid" → "username@host:project"
  const slash = instanceId.lastIndexOf("/");
  const base = slash > 0 ? instanceId.slice(0, slash) : instanceId;
  // Truncate long labels
  return base.length > 28 ? base.slice(0, 26) + "…" : base;
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 2) return;
  const ux = dx / len;
  const uy = dy / len;

  // Stop line at node perimeter
  const ex = x2 - ux * (NODE_RADIUS + 4);
  const ey = y2 - uy * (NODE_RADIUS + 4);
  const sx = x1 + ux * (NODE_RADIUS + 4);
  const sy = y1 + uy * (NODE_RADIUS + 4);

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();

  // Arrowhead
  const headLen = 8 + width;
  const angle = Math.atan2(ey - sy, ex - sx);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(
    ex - headLen * Math.cos(angle - Math.PI / 7),
    ey - headLen * Math.sin(angle - Math.PI / 7),
  );
  ctx.lineTo(
    ex - headLen * Math.cos(angle + Math.PI / 7),
    ey - headLen * Math.sin(angle + Math.PI / 7),
  );
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function render(
  ctx: CanvasRenderingContext2D,
  nodes: SimNode[],
  edges: SimEdge[],
  w: number,
  h: number,
  hoveredId: string | null,
  selectedId: string | null,
): void {
  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle grid
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 0.5;
  const step = 48;
  for (let x = 0; x < w; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  if (nodes.length === 0) {
    ctx.fillStyle = "#3a5470";
    ctx.font = "14px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText("No instances connected", w / 2, h / 2);
    return;
  }

  const idxMap = new Map(nodes.map((n, i) => [n.id, i]));
  const maxWeight = Math.max(1, ...edges.map((e) => e.weight));

  // Draw edges
  for (const edge of edges) {
    const si = idxMap.get(edge.source);
    const ti = idxMap.get(edge.target);
    if (si === undefined || ti === undefined) continue;
    const sn = nodes[si];
    const tn = nodes[ti];

    const isHighlighted =
      sn.id === hoveredId || tn.id === hoveredId ||
      sn.id === selectedId || tn.id === selectedId;
    const isSelected =
      sn.id === selectedId || tn.id === selectedId;

    const t = edge.weight / maxWeight;
    const width = 1 + t * 4;
    const color = isSelected
      ? C.edgeSelected
      : isHighlighted
        ? C.edgeHot
        : C.edgeDefault;

    drawArrow(ctx, sn.x, sn.y, tn.x, tn.y, color, width);

    // Weight label on hot edges
    if (isHighlighted && edge.weight > 1) {
      const mx = (sn.x + tn.x) / 2;
      const my = (sn.y + tn.y) / 2;
      ctx.font = "10px JetBrains Mono, monospace";
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.fillText(`×${edge.weight}`, mx, my - 6);
    }
  }

  // Draw nodes
  for (const node of nodes) {
    const isHovered = node.id === hoveredId;
    const isSelected = node.id === selectedId;
    const stroke = isSelected ? C.nodeSelected : isHovered ? C.nodeHover : node.online ? C.nodeOnline : C.nodeOffline;
    const fill = node.online ? C.nodeOnlineFill : C.nodeOfflineFill;
    const r = isHovered || isSelected ? NODE_RADIUS + 3 : NODE_RADIUS;

    // Glow for online nodes
    if (node.online && (isHovered || isSelected)) {
      ctx.shadowColor = stroke;
      ctx.shadowBlur = 16;
    }

    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = isSelected ? 2.5 : isHovered ? 2 : 1.5;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Status dot
    const dotColor = node.online ? "#00d4ff" : "#2a4060";
    ctx.beginPath();
    ctx.arc(node.x + r - 5, node.y - r + 5, 4, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();

    // Label
    const label = shortLabel(node.id);
    ctx.font = `${isHovered || isSelected ? "bold " : ""}11px JetBrains Mono, monospace`;
    ctx.textAlign = "center";
    ctx.fillStyle = node.online ? C.labelOnline : C.label;
    ctx.fillText(label, node.x, node.y + r + 14);

    // Role badge
    if (node.role) {
      ctx.font = "9px JetBrains Mono, monospace";
      ctx.fillStyle = C.labelRole;
      ctx.fillText(`[${node.role}]`, node.x, node.y + r + 26);
    }
  }
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface TooltipData {
  x: number;
  y: number;
  node: SimNode;
  inCount: number;
  outCount: number;
}

function TooltipPanel({ data }: { data: TooltipData }) {
  return (
    <div
      className="pointer-events-none absolute z-10 rounded text-xs font-mono"
      style={{
        left: data.x + 16,
        top: data.y - 8,
        background: C.tooltip.bg,
        border: `1px solid ${C.tooltip.border}`,
        padding: "8px 12px",
        color: C.tooltip.text,
        minWidth: 200,
        maxWidth: 320,
        backdropFilter: "blur(4px)",
      }}
    >
      <div style={{ color: data.node.online ? C.nodeOnline : C.label, fontWeight: "bold", marginBottom: 4 }}>
        {data.node.online ? "● ONLINE" : "○ OFFLINE"}
      </div>
      <div style={{ color: C.tooltip.text, wordBreak: "break-all", marginBottom: 4 }}>
        {data.node.id}
      </div>
      {data.node.role && (
        <div style={{ color: C.labelRole, marginBottom: 4 }}>role: {data.node.role}</div>
      )}
      <div style={{ color: C.tooltip.dim, borderTop: `1px solid ${C.tooltip.border}`, paddingTop: 4, marginTop: 4 }}>
        <span>↑ sent: {data.outCount}</span>
        <span style={{ marginLeft: 12 }}>↓ recv: {data.inCount}</span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function GraphPage() {
  const { instances, feed } = useContext(WsContext);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const rafRef = useRef<number>(0);
  const sizeRef = useRef({ w: 800, h: 600 });

  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // Compute edge counts once — used for both display stats and the simulation.
  // The Map is built here so neither the display memo nor the simulation ref
  // need to duplicate the iteration over feed.
  const edgeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const fm of feed) {
      if (fm.isBroadcast || fm.topicName) continue;
      const key = `${fm.message.from}→${fm.message.to}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [feed]);

  // Display stats derived from the shared edgeCounts computation
  const edgeStats = useMemo(
    () => ({
      count: edgeCounts.size,
      total: Array.from(edgeCounts.values()).reduce((s, v) => s + v, 0),
    }),
    [edgeCounts],
  );

  // Sync edges ref for use in the animation loop (not a render concern)
  const edgesRef = useRef<SimEdge[]>([]);
  useEffect(() => {
    edgesRef.current = Array.from(edgeCounts.entries()).map(([key, weight]) => {
      const arrow = key.indexOf("→");
      return { source: key.slice(0, arrow), target: key.slice(arrow + 1), weight };
    });
  }, [edgeCounts]);

  // Sync nodes from instances map — preserve existing positions
  useEffect(() => {
    const { w, h } = sizeRef.current;
    const cx = w / 2;
    const cy = h / 2;
    const existing = new Map(nodesRef.current.map((n) => [n.id, n]));
    const next: SimNode[] = [];
    for (const inst of instances.values()) {
      const prev = existing.get(inst.instanceId);
      if (prev) {
        prev.online = inst.status === "online";
        prev.role = inst.role;
        next.push(prev);
      } else {
        // Spawn at random position near center
        const angle = Math.random() * Math.PI * 2;
        const r = 80 + Math.random() * 100;
        next.push({
          id: inst.instanceId,
          label: shortLabel(inst.instanceId),
          role: inst.role,
          online: inst.status === "online",
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
          vx: 0,
          vy: 0,
          pinned: false,
        });
      }
    }
    nodesRef.current = next;
  }, [instances]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
      sizeRef.current = { w: width, h: height };
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Refs to carry hovered/selected state into the animation loop closure
  // without storing them on the DOM element or re-creating the loop.
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);

  // Keep refs in sync with React state — no DOM property assignment needed
  useEffect(() => { hoveredRef.current = hoveredId; }, [hoveredId]);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function loop() {
      const ctx = canvas?.getContext("2d");
      if (!ctx) return;
      const { w, h } = sizeRef.current;
      tick(nodesRef.current, edgesRef.current, w / 2, h / 2, w, h);
      render(ctx, nodesRef.current, edgesRef.current, w, h, hoveredRef.current, selectedRef.current);
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Hit test
  const hitTest = useCallback((cx: number, cy: number): SimNode | null => {
    for (const n of nodesRef.current) {
      const dx = n.x - cx;
      const dy = n.y - cy;
      if (dx * dx + dy * dy <= (NODE_RADIUS + 6) ** 2) return n;
    }
    return null;
  }, []);

  const canvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
  }, []);

  // Mouse handlers
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { cx, cy } = canvasCoords(e);
    const node = hitTest(cx, cy);
    setHoveredId(node?.id ?? null);

    if (node) {
      const outCount = edgesRef.current.filter((ed) => ed.source === node.id).reduce((s, ed) => s + ed.weight, 0);
      const inCount = edgesRef.current.filter((ed) => ed.target === node.id).reduce((s, ed) => s + ed.weight, 0);
      setTooltip({ x: cx, y: cy, node, inCount, outCount });
    } else {
      setTooltip(null);
    }

    if (dragId) {
      const n = nodesRef.current.find((nd) => nd.id === dragId);
      if (n) { n.x = cx; n.y = cy; n.vx = 0; n.vy = 0; }
    }
  }, [hitTest, canvasCoords, dragId]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { cx, cy } = canvasCoords(e);
    const node = hitTest(cx, cy);
    if (node) {
      node.pinned = true;
      setDragId(node.id);
      setSelectedId((prev) => (prev === node.id ? null : node.id));
    } else {
      setSelectedId(null);
    }
  }, [hitTest, canvasCoords]);

  const onMouseUp = useCallback(() => {
    if (dragId) {
      const n = nodesRef.current.find((nd) => nd.id === dragId);
      if (n) n.pinned = false;
    }
    setDragId(null);
  }, [dragId]);

  const onMouseLeave = useCallback(() => {
    setHoveredId(null);
    setTooltip(null);
    if (dragId) {
      const n = nodesRef.current.find((nd) => nd.id === dragId);
      if (n) n.pinned = false;
      setDragId(null);
    }
  }, [dragId]);

  // Stats
  const onlineCount = Array.from(instances.values()).filter((i) => i.status === "online").length;
  const offlineCount = instances.size - onlineCount;
  const { count: edgeCount, total: msgCount } = edgeStats;

  return (
    <div className="flex h-[calc(100vh-48px)] flex-col" style={{ background: C.bg }}>
      {/* Stats bar */}
      <div
        className="flex shrink-0 items-center gap-6 border-b px-4 py-2 font-mono text-xs"
        style={{ borderColor: "#1a3356", background: "#070f1e" }}
      >
        <Stat label="ONLINE" value={onlineCount} color="#00d4ff" />
        <Stat label="OFFLINE" value={offlineCount} color="#3a5470" />
        <Stat label="FLOWS" value={edgeCount} color="#6b8aaa" />
        <Stat label="MESSAGES" value={msgCount} color="#6b8aaa" />
        <div className="ml-auto" style={{ color: "#3a5470" }}>
          drag nodes · click to select · hover for details
        </div>
      </div>

      {/* Canvas container */}
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{ cursor: dragId ? "grabbing" : hoveredId ? "grab" : "default" }}
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
        />
        {tooltip && <TooltipPanel data={tooltip} />}

        {/* Legend */}
        <div
          className="absolute bottom-4 right-4 rounded font-mono text-xs"
          style={{
            background: "rgba(7,15,30,0.85)",
            border: "1px solid #1a3356",
            padding: "8px 12px",
            color: "#3a5470",
          }}
        >
          <LegendRow color="#00d4ff" label="online instance" />
          <LegendRow color="#1a3356" label="offline instance" />
          <LegendRow color="rgba(0,212,255,0.7)" label="message flow (thicker = more)" />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span style={{ color: "#3a5470" }}>{label}</span>
      <span style={{ color, fontWeight: "bold" }}>{value}</span>
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: color,
          border: `1px solid ${color}`,
          flexShrink: 0,
        }}
      />
      <span>{label}</span>
    </div>
  );
}
