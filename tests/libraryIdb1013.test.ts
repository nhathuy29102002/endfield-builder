import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Thư viện bản vẽ chuyển sang IndexedDB (2026-10-13) — `src/blueprint/library.ts`. Môi trường test không có IndexedDB
 * ⇒ dùng một **IndexedDB giả** tối giản trong bộ nhớ (open / upgradeneeded / transaction / get / put / delete, gọi lại
 * bất đồng bộ như trình duyệt). Mỗi ca nạp lại module (`vi.resetModules`) vì kho giữ trạng thái ở cấp module.
 */
type Rec = Map<string, unknown>;
function fakeIndexedDb(dbs: Map<string, Rec>, opts: { failOpen?: boolean; failWrite?: boolean } = {}): IDBFactory {
  const later = (f: () => void): void => void setTimeout(f, 0);
  const open = (name: string): IDBOpenDBRequest => {
    const req = {} as IDBOpenDBRequest & Record<string, unknown>;
    later(() => {
      if (opts.failOpen) {
        (req as { error: unknown }).error = new Error('open failed');
        (req.onerror as (() => void) | null)?.();
        return;
      }
      const fresh = !dbs.has(name);
      if (fresh) dbs.set(name, new Map());
      const data = dbs.get(name)!;
      const stores = new Set<string>(fresh ? [] : ['kv']);
      const db = {
        objectStoreNames: { contains: (s: string) => stores.has(s) },
        createObjectStore: (s: string) => void stores.add(s),
        transaction: () => {
          const tx = {} as IDBTransaction & Record<string, unknown>;
          const store = {
            get: (k: string) => {
              const r = {} as IDBRequest & Record<string, unknown>;
              later(() => {
                (r as { result: unknown }).result = structuredClone(data.get(k));
                (r.onsuccess as (() => void) | null)?.();
              });
              return r;
            },
            put: (v: unknown, k: string) => {
              const copy = structuredClone(v);
              later(() => {
                if (opts.failWrite) return (tx.onabort as (() => void) | null)?.();
                data.set(k, copy);
                (tx.oncomplete as (() => void) | null)?.();
              });
            },
            delete: (k: string) => {
              later(() => {
                data.delete(k);
                (tx.oncomplete as (() => void) | null)?.();
              });
            },
          };
          (tx as unknown as { objectStore: () => unknown }).objectStore = () => store;
          return tx;
        },
      };
      (req as { result: unknown }).result = db;
      if (fresh) (req.onupgradeneeded as (() => void) | null)?.();
      (req.onsuccess as (() => void) | null)?.();
    });
    return req;
  };
  return { open } as unknown as IDBFactory;
}

const g = globalThis as Record<string, unknown>;
let ls: Map<string, string>;
let dbs: Map<string, Rec>;
const bp = (id: string, name = id) => ({ id, name, icon: null, kind: 'module' as const, created: 1, preview: '', module: { machines: [], tiles: [] } });

beforeEach(() => {
  vi.resetModules();
  ls = new Map();
  dbs = new Map();
  g.localStorage = {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => void ls.set(k, v),
    removeItem: (k: string) => void ls.delete(k),
  } as Storage;
  g.window = { dispatchEvent: () => true } as unknown as Window;
});
afterEach(() => {
  delete g.indexedDB;
  delete g.localStorage;
  delete g.window;
});

describe('thư viện bản vẽ trong IndexedDB', () => {
  it('lần đầu: chép từ localStorage sang, đọc lại đủ rồi mới xoá bản cũ', async () => {
    ls.set('efp:library', JSON.stringify([bp('a'), bp('b')]));
    g.indexedDB = fakeIndexedDb(dbs);
    const lib = await import('../src/blueprint/library');
    await lib.initLibraryStore();
    expect(lib.libraryUsesIndexedDb()).toBe(true);
    expect(lib.loadLibrary().map((b) => b.id)).toEqual(['a', 'b']);
    expect(ls.has('efp:library')).toBe(false);
    expect((dbs.get('efp')!.get('library') as { id: string }[]).map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('lưu: bộ nhớ đổi ngay, IndexedDB ghi theo thứ tự; đọc ra là bản sao', async () => {
    g.indexedDB = fakeIndexedDb(dbs);
    const lib = await import('../src/blueprint/library');
    await lib.initLibraryStore();
    lib.saveLibrary([bp('x')]);
    lib.saveLibrary([bp('x'), bp('y')]);
    expect(lib.loadLibrary().map((b) => b.id)).toEqual(['x', 'y']);
    await lib.libraryWritesSettled();
    expect((dbs.get('efp')!.get('library') as unknown[]).length).toBe(2);
    // sửa bản đọc ra không làm đổi dữ liệu thật
    const copy = lib.loadLibrary();
    copy[0]!.name = 'đổi';
    expect(lib.loadLibrary()[0]!.name).toBe('x');
    // localStorage không còn được dùng
    expect(ls.has('efp:library')).toBe(false);
  });

  it('cả hai nơi có dữ liệu ⇒ gộp theo id, giữ bản trong IndexedDB khi trùng', async () => {
    dbs.set('efp', new Map([['library', [bp('a', 'A trong IDB')]]]));
    ls.set('efp:library', JSON.stringify([bp('a', 'A cũ'), bp('b')]));
    g.indexedDB = fakeIndexedDb(dbs);
    const lib = await import('../src/blueprint/library');
    await lib.initLibraryStore();
    expect(lib.loadLibrary().map((b) => `${b.id}:${b.name}`)).toEqual(['a:A trong IDB', 'b:b']);
    expect(ls.has('efp:library')).toBe(false);
  });

  it('không mở được IndexedDB ⇒ chạy như cũ bằng localStorage, không xoá gì', async () => {
    ls.set('efp:library', JSON.stringify([bp('a')]));
    g.indexedDB = fakeIndexedDb(dbs, { failOpen: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const lib = await import('../src/blueprint/library');
    await lib.initLibraryStore();
    warn.mockRestore();
    expect(lib.libraryUsesIndexedDb()).toBe(false);
    expect(lib.loadLibrary().map((b) => b.id)).toEqual(['a']);
    lib.saveLibrary([bp('a'), bp('c')]);
    expect(JSON.parse(ls.get('efp:library')!).length).toBe(2);
  });

  it('không có IndexedDB (test, trình duyệt chặn) ⇒ localStorage', async () => {
    const lib = await import('../src/blueprint/library');
    await lib.initLibraryStore();
    expect(lib.libraryUsesIndexedDb()).toBe(false);
    lib.saveLibrary([bp('z')]);
    expect(JSON.parse(ls.get('efp:library')!)[0].id).toBe('z');
  });

  it('ghi IndexedDB lỗi ⇒ phát sự kiện báo lỗi (không ném), dữ liệu trong phiên vẫn còn', async () => {
    const opts: { failWrite?: boolean } = {};
    g.indexedDB = fakeIndexedDb(dbs, opts);
    const lib = await import('../src/blueprint/library');
    await lib.initLibraryStore();
    opts.failWrite = true;
    const events: string[] = [];
    g.window = { dispatchEvent: (e: Event) => (events.push(e.type), true) } as unknown as Window;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => lib.saveLibrary([bp('q')])).not.toThrow();
    await lib.libraryWritesSettled();
    warn.mockRestore();
    expect(events).toContain('efp:library-error');
    expect(lib.loadLibrary().map((b) => b.id)).toEqual(['q']);
    // lần ghi sau (hết lỗi) vẫn chạy — chuỗi ghi không kẹt
    opts.failWrite = false;
    lib.saveLibrary([bp('q'), bp('r')]);
    await lib.libraryWritesSettled();
    expect((dbs.get('efp')!.get('library') as unknown[]).length).toBe(2);
  });
});
