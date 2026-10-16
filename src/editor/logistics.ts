import type { Tool } from './state';

/**
 * **Bộ băng / ống** của máy tính (người dùng 2026-10-11): bấm nút Băng (E) / Ống (Q) ⇒ thanh dọc nhỏ sổ ra bên trái nút với
 * 5 lựa chọn theo đúng thứ tự: băng / ống thường · bộ tách · bộ gộp · cảng kiểm soát · cầu. **Tab** đổi lần lượt sang loại
 * kế tiếp (hết thì quay về băng / ống thường). Chỉ băng / ống thường là công cụ vẽ để nối (`link`); 4 loại còn lại cầm lên
 * và đặt như chọn ở bảng chọn máy (`place`).
 */
export const LINK_FAMILY: Record<'belt' | 'pipe', readonly string[]> = {
  belt: ['log_splitter', 'log_converger', 'log_conditioner', 'log_connector'],
  pipe: ['log_pipe_splitter', 'log_pipe_converger', 'log_pipe_conditioner', 'log_pipe_connector'],
};

/** Công cụ đang cầm thuộc bộ băng hay bộ ống (vẽ băng / ống thường, hoặc đang đặt mới một van / cầu của bộ đó). */
export function linkFamily(tool: Tool): 'belt' | 'pipe' | null {
  if (tool.kind === 'link') return tool.linkKind;
  if (tool.kind === 'place' && (tool.mode ?? 'new') === 'new')
    for (const kind of ['belt', 'pipe'] as const) if (LINK_FAMILY[kind].includes(tool.machineId)) return kind;
  return null;
}

/** Công cụ của mục thứ `i` trong bộ (0 = băng / ống thường). */
export function familyTool(kind: 'belt' | 'pipe', i: number): Tool {
  const n = LINK_FAMILY[kind].length + 1;
  const k = ((i % n) + n) % n;
  return k === 0 ? { kind: 'link', linkKind: kind } : { kind: 'place', machineId: LINK_FAMILY[kind][k - 1]!, rot: 0, mode: 'new' };
}

/** Vị trí của công cụ đang cầm trong bộ (0 = thường), hoặc -1. */
export function familyIndex(tool: Tool): number {
  const kind = linkFamily(tool);
  if (!kind) return -1;
  return tool.kind === 'place' ? LINK_FAMILY[kind].indexOf(tool.machineId) + 1 : 0;
}

/** Tab: sang loại kế tiếp trong bộ; giữ hướng xoay đang dùng khi chuyển giữa các van / cầu. */
export function nextInFamily(tool: Tool): Tool | null {
  const kind = linkFamily(tool);
  if (!kind) return null;
  const next = familyTool(kind, familyIndex(tool) + 1);
  if (next.kind === 'place' && tool.kind === 'place') return { ...next, rot: tool.rot };
  return next;
}
