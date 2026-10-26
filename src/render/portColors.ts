import { roleOf } from '../model/roles';
import { activePorts, portKey, type MachineDef, type PortKey } from '../model/types';

/** Màu hai đầu ống ra: đầu thứ nhất vàng, đầu thứ hai cam. */
export const PIPE_OUT_COLORS = ['#ffd23f', '#ff8a1f'] as const;

/**
 * Màu đầu ống ra của máy (không kể van/cầu và cổng `virtual`), theo **bộ cổng của chế độ đang bật** (`mode`):
 *  - đúng **hai** đầu ống ra: hai đầu có thể ra hai chất khác nhau ⇒ đầu thứ nhất vàng, đầu thứ hai cam;
 *  - chỉ **một** đầu ống ra ⇒ cam (người dùng 2026-10-26: "màu cam nếu chỉ có 1 cổng output ra").
 * Dùng ở mũi tên cổng khi preview, mũi tên của ô ống đầu tiên cắm vào mỗi đầu, dải sáng ở ô kề cổng.
 *
 * Thứ tự vàng → cam theo `index` cổng trong dữ liệu game (suy luận: chưa đối chiếu với màu thật trong game).
 */
export function pipeOutColor(def: MachineDef, key: PortKey, mode?: 'A' | 'B'): string | undefined {
  const role = roleOf(def);
  if (def.router || role === 'bridge') return undefined;
  const outs = activePorts(def, mode)
    .filter((p) => p.dir === 'out' && p.kind === 'pipe' && !p.virtual)
    .sort((a, b) => a.index - b.index);
  const i = outs.findIndex((p) => portKey(p.dir, p.index) === key);
  if (i < 0) return undefined;
  if (outs.length === 1) return PIPE_OUT_COLORS[1];
  return outs.length === 2 ? PIPE_OUT_COLORS[i] : undefined;
}

/** Màu dải sáng ở ô kề **cổng kích hoạt** (người dùng 2026-10-05: tông xanh lá). */
export const ACTIVATOR_GLOW = '#3ddc84';
/** Màu dải sáng ở ô kề **cổng ống vào** (người dùng 2026-10-26: trắng). */
export const PIPE_IN_GLOW = '#ffffff';

/**
 * Màu **dải sáng nhấp nháy** ở ô kề cổng `key` của máy ở chế độ `mode` (Map và cả khi mô phỏng):
 *  - cổng kích hoạt ⇒ xanh lá (người dùng 2026-10-05);
 *  - mọi cổng **ống vào** khác ⇒ trắng; cổng **ống ra** ⇒ vàng / cam như `pipeOutColor` (người dùng 2026-10-26 — trước
 *    đó chỉ cổng ra của 6 máy phản ứng / chuyển hoá có dải).
 * Van / cầu ống và cổng băng ⇒ không có. Máy đổi chế độ (rắn ⇄ lỏng) ⇒ dải theo bộ cổng của chế độ mới.
 */
export function portGlowColor(def: MachineDef, key: PortKey, mode?: 'A' | 'B'): string | undefined {
  if (def.activatorPort && key === def.activatorPort) return ACTIVATOR_GLOW;
  if (def.router || roleOf(def) === 'bridge') return undefined;
  const p = activePorts(def, mode).find((x) => portKey(x.dir, x.index) === key);
  if (!p || p.kind !== 'pipe' || p.virtual) return undefined;
  return p.dir === 'in' ? PIPE_IN_GLOW : pipeOutColor(def, key, mode);
}

/** Máy này có cổng nào cần dải sáng không (lọc nhanh trước khi tính cổng — mọi chế độ). */
export const hasPortGlow = (def: MachineDef): boolean =>
  !!def.activatorPort || (!def.router && roleOf(def) !== 'bridge' && def.ports.some((p) => p.kind === 'pipe' && !p.virtual));
