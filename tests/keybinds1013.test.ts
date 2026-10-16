import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Bảng phím tắt tuỳ chỉnh (người dùng 2026-10-13) — `src/keybinds.ts`. Mỗi ca nạp lại module (kho giữ ở cấp module). */
type Ev = { code: string; key: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; isTrusted?: boolean };
const kev = (code: string, key: string, o: Partial<Ev> = {}): KeyboardEvent =>
  ({ code, key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, isTrusted: true, ...o }) as unknown as KeyboardEvent;

const g = globalThis as Record<string, unknown>;
let ls: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  ls = new Map([['efp:lang', 'vi']]); // cố định tiếng Việt (CI chạy với ngôn ngữ en-US)
  g.localStorage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v), removeItem: (k: string) => void ls.delete(k) } as Storage;
  g.window = { dispatchEvent: () => true } as unknown as Window;
});

describe('phím tắt tuỳ chỉnh', () => {
  it('phím mặc định: M = mô phỏng, G = di chuyển (Map), Ctrl+Shift+S = thư viện, Ctrl+S không lẫn', async () => {
    const kb = await import('../src/keybinds');
    expect(kb.actionOf(kev('KeyM', 'm'), ['map', 'general'])).toBe('map.sim');
    expect(kb.actionOf(kev('KeyG', 'g'), ['map', 'general'])).toBe('map.move');
    expect(kb.actionOf(kev('KeyM', 'm'), ['modeler', 'general'])).toBe('md.move');
    expect(kb.actionOf(kev('KeyS', 's', { ctrlKey: true, shiftKey: true }), ['general'])).toBe('library');
    expect(kb.actionOf(kev('KeyS', 's', { ctrlKey: true }), ['general'])).toBe('save');
    expect(kb.actionOf(kev('KeyR', 'r'), ['modeler'])).toBe('md.pen');
    expect(kb.actionOf(kev('KeyF', 'f'), ['modeler'])).toBe('md.fit');
    expect(kb.matches('tutNext', kev('Enter', 'Enter'))).toBe(true);
    expect(kb.matches('machineWin', kev('F2', 'F2'))).toBe(true);
    // Ctrl một mình (checklist); W khớp cả khi giữ Shift (di chuyển bản đồ)
    expect(kb.matches('checklist', kev('ControlLeft', 'Control', { ctrlKey: true }))).toBe(true);
    expect(kb.matches('map.up', kev('KeyW', 'w', { shiftKey: true }))).toBe(true);
    // bộ gõ tiếng Việt: "ư" do Unikey gửi = phím W
    expect(kb.matches('map.up', kev('', 'ư'))).toBe(true);
  });

  it('phím mặc định không có chỗ nào trùng', async () => {
    const kb = await import('../src/keybinds');
    for (const a of kb.ACTIONS) for (const c of kb.bindings(a.id)) expect(kb.conflictsOf(a.id, c).map((x) => x.id), a.id).toEqual([]);
  });

  it('đổi phím: lưu phần khác mặc định, báo trùng, sự kiện do app gửi vẫn nhận phím mặc định', async () => {
    const kb = await import('../src/keybinds');
    kb.setBinding('map.move', 0, { key: 'm' });
    expect(JSON.parse(ls.get('efp:keybinds')!)['map.move'][0]).toEqual({ key: 'm' });
    expect(kb.conflictsOf('map.move', { key: 'm' }).map((a) => a.id)).toEqual(['map.sim']);
    expect(kb.keyLabel('map.move')).toBe('M');
    // phím G thật không còn là di chuyển; nút trên màn hình gửi phím mặc định (isTrusted = false) thì vẫn nhận
    expect(kb.matches('map.move', kev('KeyG', 'g'))).toBe(false);
    expect(kb.matches('map.move', kev('KeyG', 'g', { isTrusted: false }))).toBe(true);
    // về lại mặc định ⇒ không còn lưu gì cho thao tác đó
    kb.setBinding('map.move', 0, { key: 'g' });
    expect(JSON.parse(ls.get('efp:keybinds')!)).toEqual({});
    // bỏ phím ⇒ thao tác chưa gán thì chú thích không có ngoặc
    kb.setBinding('map.labels', 0, null);
    expect(kb.keyHint('map.labels')).toBe('');
    kb.resetBindings('map');
    expect(kb.keyLabel('map.labels')).toBe('N');
  });

  it('Space: chỉnh sửa và mô phỏng là hai hoàn cảnh — không báo trùng; khác nhóm (Map ⇄ Modeler) cũng không', async () => {
    const kb = await import('../src/keybinds');
    expect(kb.conflictsOf('map.mode', { key: 'space' })).toEqual([]);
    expect(kb.conflictsOf('map.rotate', { key: 'r' })).toEqual([]);
    // nhóm Chung đụng mọi nhóm
    expect(kb.conflictsOf('map.rotate', { key: 'l' }).map((a) => a.id)).toEqual(['recipes']);
  });

  it('nút chuột cho "mở thư viện vật phẩm"', async () => {
    const kb = await import('../src/keybinds');
    const mev = (button: number, o: Partial<MouseEvent> = {}): MouseEvent =>
      ({ button, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, isTrusted: true, ...o }) as unknown as MouseEvent;
    expect(kb.matches('itemLib', mev(1))).toBe(true);
    expect(kb.matches('itemLib', mev(0))).toBe(false);
    kb.setBinding('itemLib', 1, { key: 'mouse0', ctrl: true });
    expect(kb.matches('itemLib', mev(0, { ctrlKey: true }))).toBe(true);
    expect(kb.comboLabel({ key: 'mouse0', ctrl: true })).toBe('Ctrl+Chuột trái');
  });
});
