import type { MachineDef } from './types';

/**
 * Nhóm máy như thanh chọn nhanh của game (và trang tham khảo). Lấy thẳng từ `quickBarType` của bảng
 * dữ liệu game; tên nhóm dùng tên tiếng Anh của game (trang tham khảo: mã tên của nhóm `storage` là
 * "Depot Access", `source_machine` là "Resourcing"…). Van/cầu không có `quickBarType`,
 * trong game chúng nằm ở nhóm `logistic`.
 */
export const CATEGORY_ORDER = [
  'Resourcing',
  'Depot Access',
  'Logistic Unit',
  'Production I',
  'Production II',
  'Power',
  'Miscellaneous',
] as const;
export type Category = (typeof CATEGORY_ORDER)[number];

const BY_QUICKBAR: Record<string, Category> = {
  source_machine: 'Resourcing',
  storage: 'Depot Access',
  logistic: 'Logistic Unit',
  '': 'Logistic Unit',
  basic_machine: 'Production I',
  assemble_machine: 'Production II',
  electric_machine: 'Power',
  extra_machine: 'Miscellaneous',
};

/**
 * Icon của 6 nhóm chính — ảnh của game tải từ trang tham khảo (`workshopcrafttypeicon`, lớp `.category`), lưu
 * ở `public/img/category/`. Nhóm Miscellaneous **không** có icon (người dùng 2026-09-29).
 */
export const CATEGORY_ICON: Partial<Record<Category, string>> = {
  Resourcing: 'img/category/icon_source_new_machine.png',
  'Depot Access': 'img/category/icon_storage.png',
  'Logistic Unit': 'img/category/icon_logistic.png',
  'Production I': 'img/category/icon_basic_new_machine.png',
  'Production II': 'img/category/icon_assemble_new_machine.png',
  Power: 'img/category/icon_electric_machine.png',
};

/** Nhóm của máy; `null` = máy ẩn (không hiện ở bảng chọn). */
/**
 * Máy vẫn xây được nhưng **cất vào phần Ẩn** của bảng chọn máy (người dùng 2026-10-13): các giàn khai thác (Giàn
 * Originium Di Động, Giàn Khai Thác Điện / Mk II / Thủy Lực), Tháp Tiếp Điện, Tiếp Điện Xiranite. Bật "Hiện ẩn" để thấy.
 */
export const PALETTE_HIDDEN = new Set(['miner_1', 'miner_2', 'miner_3', 'miner_4', 'power_pole_2', 'power_pole_3']);

export function categoryOf(def: MachineDef): Category | null {
  if (def.quickBar === 'hidden' || PALETTE_HIDDEN.has(def.id)) return null;
  return BY_QUICKBAR[def.quickBar] ?? 'Miscellaneous';
}

/** Dòng phụ ngắn dưới tên máy: `4x6 · 20MW`. */
export const machineMeta = (def: MachineDef): string =>
  `${def.size.w}x${def.size.d}${def.power > 0 ? ` · ${def.power}MW` : ''}`;
