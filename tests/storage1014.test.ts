import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyBlueprint } from '../src/model/types';
import { serializeTabs, type TabRecord } from '../src/editor/tabs';

/** Lưu trữ an toàn hơn (rà soát 2026-10-14): tab hỏng chỉ mất tab đó, lỗi ghi được báo, chọn ngôn ngữ lần đầu. */
const g = globalThis as Record<string, unknown>;
let ls: Map<string, string>;
let failWrites = false;
const events: { type: string; detail?: unknown }[] = [];
beforeEach(() => {
  vi.resetModules();
  // cố định tiếng Việt: không thì app chọn theo ngôn ngữ của máy chạy test (CI = en-US) — rà soát 2026-10-14
  ls = new Map([['efp:lang', 'vi']]);
  failWrites = false;
  events.length = 0;
  g.localStorage = {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failWrites) throw new DOMException('full', 'QuotaExceededError');
      ls.set(k, v);
    },
    removeItem: (k: string) => void ls.delete(k),
  } as Storage;
  g.window = { dispatchEvent: (e: Event) => (events.push({ type: e.type, detail: (e as CustomEvent).detail }), true) } as unknown as Window;
});
afterEach(() => {
  delete g.localStorage;
  delete g.window;
});

const mapTab = (id: string): TabRecord => ({ id, kind: 'map', title: id, saved: null, map: { bp: emptyBlueprint(), terrain: {}, undo: [], redo: [] } });

describe('đọc tab đã lưu', () => {
  it('một map hỏng chỉ bỏ tab đó — tab Modeler và map khác vẫn mở, bản gốc được cất lại', async () => {
    const raw = JSON.parse(serializeTabs([mapTab('a'), mapTab('b'), { id: 'm', kind: 'modeler', title: 'M', saved: null }], 'b')) as { tabs: { map?: string }[] };
    raw.tabs[1]!.map = '{ hỏng';
    ls.set('efp:tabs', JSON.stringify(raw));
    const { loadTabs, tabsLoadIssue } = await import('../src/editor/tabs');
    const got = loadTabs();
    expect(got?.tabs.map((t) => t.id)).toEqual(['a', 'm']);
    expect(got?.active).toBe('a'); // tab đang mở bị hỏng ⇒ tab đầu
    expect(tabsLoadIssue()).toMatch(/1 tab/);
    expect(JSON.parse(ls.get('efp:tabs-broken')!).tabs).toHaveLength(1);
  });

  it('cả khối hỏng ⇒ null nhưng giữ bản sao trước khi bị ghi đè', async () => {
    ls.set('efp:tabs', '{"version":1,"tabs":[');
    const { loadTabs, tabsLoadIssue } = await import('../src/editor/tabs');
    expect(loadTabs()).toBeNull();
    expect(ls.get('efp:tabs-backup')).toBe('{"version":1,"tabs":[');
    expect(tabsLoadIssue()).not.toBeNull();
  });

  it('chưa có gì ⇒ null, không báo lỗi', async () => {
    const { loadTabs, tabsLoadIssue } = await import('../src/editor/tabs');
    expect(loadTabs()).toBeNull();
    expect(tabsLoadIssue()).toBeNull();
  });
});

describe('ghi lỗi được báo', () => {
  it('hết chỗ khi tự lưu map ⇒ phát sự kiện báo lỗi (gộp: một lần mỗi 30 s)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { saveNow } = await import('../src/blueprint/autosave');
    failWrites = true;
    saveNow({ bp: emptyBlueprint(), terrain: {} });
    saveNow({ bp: emptyBlueprint(), terrain: {} });
    warn.mockRestore();
    const errs = events.filter((e) => e.type === 'efp:storage-error');
    expect(errs).toHaveLength(1);
    expect(String(errs[0]!.detail)).toMatch(/đầy/);
  });
});

describe('ngôn ngữ lần đầu mở', () => {
  const withLangs = async (langs: string[]): Promise<string> => {
    ls.delete('efp:lang'); // người dùng chưa chọn ngôn ngữ lần nào
    vi.stubGlobal('navigator', { languages: langs, language: langs[0] });
    const { lang } = await import('../src/i18n');
    vi.unstubAllGlobals();
    return lang().code;
  };
  it('người dùng mới: theo trình duyệt; không có ngôn ngữ nào app hỗ trợ ⇒ tiếng Anh', async () => {
    expect(await withLangs(['vi-VN', 'en'])).toBe('vi');
  });
  it('trình duyệt tiếng Đức ⇒ tiếng Anh, và nhớ lựa chọn', async () => {
    expect(await withLangs(['de-DE'])).toBe('en');
    expect(ls.get('efp:lang')).toBe('en');
  });
  it('người dùng cũ (đã có tab lưu) ⇒ giữ tiếng Việt dù trình duyệt tiếng Anh', async () => {
    ls.set('efp:tabs', '{}');
    expect(await withLangs(['en-US'])).toBe('vi');
  });
});
