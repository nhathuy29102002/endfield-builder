import { mountBatchHud } from './ui/batchHud';
import './style.css';
import { applyTheme, loadTheme } from './ui/theme';
import { mountSettings, settingsCheck, settingsSeg } from './ui/settings';
import { toggleLabels, toggleLayer } from './editor/tools';
import { onPrefs, prefs } from './ui/prefs';
import { SPEAKER_OFF, SPEAKER_ON, mountMusic, musicFileRow } from './ui/music';
import { CHECKLIST_REFRESH, mountChecklist } from './ui/checklist';
import { mountSimMode, simGroupsChanged, simTabActivated, simTabLeaving, tickSimMode } from './ui/simMode';
import { lang, tr } from './i18n';
import { PUBLIC_BUILD } from './buildFlags';
import { demoPlan } from './editor/demo';
import { attachInput } from './editor/input';
import { AppState, type EmitMode } from './editor/state';
import { Renderer } from './render/renderer';
import { el } from './ui/dom';
import { mountInspector } from './ui/inspector';
import { OPEN_RECIPES_EVENT, mountPalette, recipesButton } from './ui/palette';
import { mountSummary } from './ui/summary';
import { mountDock, mountTopbar } from './ui/dock';
import { jsonFiles, openLibrary, useBlueprint } from './ui/library';
import { LIBRARY_ERROR_EVENT, USE_BLUEPRINT_EVENT, initLibraryStore, loadLibrary } from './blueprint/library';
import { loadAutosave, saveNow, scheduleAutosave } from './blueprint/autosave';
import { DOC_EVENT, OPEN_MODELER_EVENT, TabManager, emptyModeler, loadTabs, tabsLoadIssue, mapFingerprint, type ModelerDoc, type TabGroup, type TabRecord } from './editor/tabs';
import { mountModeler } from './modeler/view';
import { mountTabBar } from './ui/tabbar';
import { openRecipeLibrary } from './ui/recipeLibrary';
import { mountItemLinks } from './ui/itemLink';
import { toast } from './ui/toast';
import { mountErrorLog } from './ui/errorLog';
import { mountShortcutBadges } from './ui/shortcutBadges';
import { confirmDialog } from './ui/dialog';
import { MAP_HINTS, MODELER_HINTS, TOUCH_MAP_HINTS, TOUCH_MODELER_HINTS, showHints } from './ui/hints';
import { isNativeApp, isTouchUI } from './platform';
import { attachDragEmulation, attachKeyboardGuard, attachLayers, attachModelerTouch, attachPanelSwipes } from './ui/touch';
import { attachMapTouch } from './ui/touchMap';
import { mountTouchActions } from './ui/touchActions';
import { mountTutorial, tutorialSettingsRow } from './ui/tutorial';
import { KEYBINDS_EVENT, actionOf, typingTarget } from './keybinds';
import { STORAGE_ERROR_EVENT, requestPersistentStorage, watchOtherWindows } from './storageGuard';
import { TOGGLE_MACHINE_WINDOW } from './ui/inspector';

// giao diện tối / sáng và ngôn ngữ đã chọn lần trước — áp trước khi dựng giao diện cho khỏi nháy
applyTheme(loadTheme());
/**
 * App Android / máy chỉ có cảm ứng (người dùng 2026-10-05): lớp `touch-ui` (+ `native-app` trong app) trên `<html>` ⇒ CSS
 * bố cục điện thoại ngang; cử chỉ ngón tay + thanh nút cảm ứng gắn bên dưới.
 */
// ghi lại lỗi chưa bắt (cho dev, không hiện lên giao diện) — đặt sớm nhất có thể
mountErrorLog();
// thư viện bản vẽ nằm trong IndexedDB (2026-10-13): đọc vào bộ nhớ **trước** khi dựng giao diện (lần đầu chép từ
// localStorage sang). Lỗi / quá 3 s ⇒ tự dùng localStorage như cũ.
await initLibraryStore();
window.addEventListener(LIBRARY_ERROR_EVENT, (e) => toast((e as CustomEvent<string>).detail, 'warn', 9000));
// lưu tab / map lỗi (hết chỗ, bị chặn) ⇒ báo, không im lặng (rà soát 2026-10-14)
window.addEventListener(STORAGE_ERROR_EVENT, (e) => toast((e as CustomEvent<string>).detail, 'warn', 9000));
// app mở ở cửa sổ / tab trình duyệt khác ⇒ cảnh báo ghi đè (các tab bản vẽ lưu chung một chỗ)
watchOtherWindows(() =>
  toast(tr('App đang mở ở một cửa sổ / tab trình duyệt khác — các tab bản vẽ lưu chung một chỗ, cửa sổ nào lưu sau sẽ ghi đè cửa sổ kia. Nên chỉ dùng một cửa sổ.'), 'warn', 9000),
);
const touch = isTouchUI();
document.documentElement.classList.toggle('touch-ui', touch);
document.documentElement.classList.toggle('native-app', isNativeApp());
document.documentElement.lang = lang().htmlLang;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error(tr('Thiếu #app'));

// Không còn thanh ngang trên cùng: công cụ là cột nút nổi nằm trong khung bản vẽ,
// sát mép bảng bên phải.
const left = el('aside', { class: 'panel left' });
const boardWrap = el('div', { class: 'board-wrap' });
const canvas = el('canvas', { class: 'board' });
const dock = el('nav', { class: 'dock' });
// góc trên-trái: Hoàn tác, Làm lại, Bản vẽ
const topbar = el('nav', { class: 'topbar' });
// cửa sổ Máy: góc phải dưới màn hình, sát lề phải — chỉ hiện khi đang chọn một máy
const machineWin = el('section', { class: 'machine-window' });
boardWrap.append(canvas, dock, topbar);
const right = el('aside', { class: 'panel right' });
// thanh tab kiểu Chrome sát mép dưới (Map / Modeler) và màn hình Modeler (đợt 2 trở đi)
const tabBar = el('nav', { class: 'tabbar' });
const modelerRoot = el('section', { class: 'modeler-root' });

// bảng phải: chỉ còn bảng tổng hợp (cửa sổ Máy là cửa sổ nổi riêng)
const summaryHost = el('div', { class: 'panel-section right-summary' });
right.append(summaryHost);
// Thanh trạng thái cũ (26px) đã bỏ — thanh tab thế chỗ (người dùng 2026-09-29). Chỉ giữ **thông báo**
// của thao tác vừa làm (vd. lý do không đặt được máy), chữ nhỏ ở cuối thanh tab.
const tabsHost = el('div', { class: 'tb-host' });
const tabMessage = el('span', { class: 'tb-msg' });
tabBar.append(tabsHost, tabMessage);
// nút Cài đặt (giao diện sáng / tối, ngôn ngữ) ở góc phải thanh tab — gắn sau khi có `renderer`, xem dưới
app.append(left, boardWrap, right, machineWin, modelerRoot, tabBar);

/**
 * Bảng Tổng hợp chỉ chiếm phần **phía trên** cửa sổ Máy: đo chiều cao cửa sổ ngay sau mỗi
 * lần nó vẽ lại, rồi chừa đúng chừng đó ở đáy bảng phải. (ResizeObserver không chạy khi
 * tab bị ẩn nên không dùng.)
 */
const fitSummary = (): void => {
  const h = machineWin.hidden ? 0 : machineWin.getBoundingClientRect().height;
  app.style.setProperty('--mw-h', `${Math.round(h)}px`);
};
window.addEventListener('resize', fitSummary);

/**
 * Màn hình máy tính lớn (người dùng 2026-10-06): 2K ⇒ 3 cửa sổ chính to ×1,25, 4K ⇒ ×1,5. Đo bề ngang màn hình theo px
 * CSS (đã tính tỉ lệ phóng của hệ điều hành — *suy luận*: màn 4K đặt Windows 150 % thì đã to sẵn, coi như 2K), không
 * theo cửa sổ trình duyệt ⇒ thu nhỏ cửa sổ không đổi cỡ chữ. Điện thoại không áp dụng.
 */
const applyUiZoom = (): void => {
  const w = window.screen?.width ?? 0;
  const k = touch ? 1 : w >= 3400 ? 1.5 : w >= 2400 ? 1.25 : 1;
  document.documentElement.classList.toggle('ui-zoom', k !== 1);
  document.documentElement.style.setProperty('--ui-k', String(k));
};
applyUiZoom();
window.addEventListener('resize', applyUiZoom);

const state = new AppState();
const renderer = new Renderer(canvas, state);
// nút loa nhỏ (nhạc nền, người dùng 2026-10-04) ngay bên trái nút Cài đặt
// điện thoại: nút loa / âm lượng, "Hiện tên máy", "Kiểm tra tầm điện" nằm trong bảng Cài đặt (người dùng 2026-10-05)
const music = mountMusic(touch ? null : tabBar);
/** Dòng loa + âm lượng của bảng Cài đặt đang mở (điện thoại) — vẽ lại khi bài nhạc đổi. */
let volSync: (() => void) | null = null;
music.onChange(() => volSync?.());
mountSettings(
  tabBar,
  () => renderer.draw(),
  touch
    ? () => {
        const slider = el('input', { class: 'tb-music-slider', type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(music.volume() * 100)) });
        const pct = el('span', { class: 'tb-music-pct' }, `${slider.value}%`);
        slider.addEventListener('input', () => {
          music.setVolume(Number(slider.value) / 100);
          pct.textContent = `${slider.value}%`;
        });
        // hình loa trước thanh âm lượng: bấm để bật / tắt nhạc nền (người dùng 2026-10-05); ô tick "Nhạc nền" đã bỏ — cái loa
        // đã cho thấy bật / tắt (người dùng 2026-10-07)
        const speaker = el('button', { class: 'set-speaker', type: 'button' });
        const sync = (): void => {
          speaker.innerHTML = music.isOn() ? SPEAKER_ON : SPEAKER_OFF;
          speaker.classList.toggle('on', music.isOn());
          const n = music.trackName();
          speaker.title = music.isOn() ? tr('Đang phát nhạc nền — bấm để tắt') : n ? tr('Bật nhạc nền ({0}, lặp lại)', n) : tr('Chưa có nhạc nền — chọn file MP3 trong Cài đặt');
        };
        speaker.addEventListener('click', () => {
          music.toggle();
          sync();
        });
        // bản Public: chưa thêm bài nhạc nào ⇒ ẩn dòng loa + âm lượng (người dùng 2026-10-11)
        const volRow = el('div', { class: 'set-row set-volume', title: tr('Âm lượng') }, speaker, slider, pct);
        const showVol = (): void => {
          volRow.hidden = PUBLIC_BUILD && !music.trackName();
        };
        volSync = (): void => {
          sync();
          showVol();
        };
        sync();
        showVol();
        return [
          musicFileRow(music),
          volRow,
          settingsCheck(tr('Hiện tên máy'), tr('Biển tên trên thân máy'), renderer.showLabels, (v) => {
            if (v !== renderer.showLabels) toggleLabels(state, renderer);
          }),
          // tầng đang xem (nút Đất / Cao của cột công cụ — điện thoại **ngang** không có nút đó; người dùng 2026-10-11)
          settingsSeg<'ground' | 'upper'>(
            tr('Tầng đang xem'),
            [
              ['ground', tr('Mặt đất')],
              ['upper', tr('Trên cao')],
            ],
            () => (renderer.activeLayer === 1 ? 'upper' : 'ground'),
            () => toggleLayer(state, renderer),
          ),
          settingsCheck(
            tr('Kiểm tra tầm điện'),
            tr('Bật: máy ngoài tầm cột / trụ điện không chạy. Tắt khi đang phác thảo'),
            state.bp.enforcePower !== false,
            (v) =>
              state.mutate(tr('Đổi kiểm tra điện'), () => {
                state.bp.enforcePower = v;
              }),
          ),
          tutorialSettingsRow(),
        ];
      }
    : // máy tính: chỉ thêm dòng chọn file nhạc (nút loa + âm lượng vẫn ở thanh tab)
      () => [musicFileRow(music), tutorialSettingsRow()],
);
// máy tính: nút Thư viện công thức ở thanh tab, ngay trái nút Cài đặt (loa dạt sang trái nó — người dùng 2026-10-07)
if (!touch) tabBar.insertBefore(recipesButton('tb-recipes'), tabBar.querySelector('.tb-settings'));
// tuỳ chọn hiển thị trong Cài đặt (người dùng 2026-10-05): nền cỏ, con trỏ ô — chỉ renderer chính, ảnh xem trước giữ nền phẳng
onPrefs((p) => {
  if (p.noTooltips) document.querySelector('.hint-box')?.remove();
  renderer.ground = p.ground;
  renderer.pointer = p.pointer;
  renderer.draw();
});

/**
 * Các tab đang mở được tự lưu trong trình duyệt (`efp:tabs`) ⇒ mở lại trang thấy đủ các tab. Lần đầu
 * (chưa có `efp:tabs`) thì lấy map tự lưu kiểu cũ (`efp:map`) làm tab đầu tiên, chưa có nữa thì bản mẫu.
 */
const initialTabs = ((): { tabs: TabRecord[]; active: string; groups?: TabGroup[] } => {
  const stored = loadTabs();
  // tab hỏng: chỉ bỏ tab đó, báo người dùng (rà soát 2026-10-14)
  const issue = tabsLoadIssue();
  if (issue) setTimeout(() => toast(issue, 'warn', 9000), 1200);
  if (stored) return stored;
  const saved = loadAutosave();
  const doc =
    saved ??
    (() => {
      const demo = demoPlan(state.ds);
      return { bp: demo.bp, terrain: demo.terrain };
    })();
  const tab: TabRecord = {
    id: 'tab-first',
    kind: 'map',
    title: saved ? 'Map 1' : tr('Bản mẫu'),
    saved: saved ? null : mapFingerprint(doc.bp, doc.terrain),
    map: { bp: doc.bp, terrain: doc.terrain, undo: [], redo: [] },
  };
  return { tabs: [tab], active: tab.id };
})();

/** Bảng bên phải đóng/mở bằng nút đầu cột nổi; nhớ trong trình duyệt. */
const RIGHT_KEY = 'efp:right';
const setRightOpen = (open: boolean): void => {
  app.classList.toggle('right-collapsed', !open);
  try {
    localStorage.setItem(RIGHT_KEY, open ? 'open' : 'closed');
  } catch {
    /* không lưu được thì thôi */
  }
};
setRightOpen((() => {
  try {
    const v = localStorage.getItem(RIGHT_KEY);
    // lần đầu bảng Tổng hợp **đóng sẵn** ở mọi phiên bản (người dùng 2026-10-07; trước đây chỉ điện thoại) — mở bằng mũi tên
    // mép phải
    return v === null ? false : v !== 'closed';
  } catch {
    return true;
  }
})());

/**
 * Cửa sổ Bản vẽ. Đang ở tab Modeler ⇒ kèm sơ đồ đang mở (để tab "Modeler" của thư viện lưu được nó).
 * `tabs` khai báo phía dưới — chỉ được dùng lúc bấm, khi nó đã có.
 */
const library = (save?: 'module' | 'map' | 'modeler', files?: File[]): void => {
  const t = tabs.active;
  openLibrary(state, renderer, {
    save,
    files,
    modeler: t.kind === 'modeler' && t.modeler ? { doc: t.modeler, title: t.title } : undefined,
  });
};
/**
 * Kéo thả file `.efp.json` vào app khi đang chỉnh sửa (Map hoặc Modeler — người dùng 2026-10-02) ⇒ mở cửa sổ Bản
 * vẽ và nhập như nút "Nhập file". Cửa sổ Bản vẽ đang mở thì nó tự nhận (`library.ts`). Luôn chặn hành vi mặc định
 * (trình duyệt mở file thay cho trang).
 */
window.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = document.querySelector('.bp-overlay') ? 'none' : 'copy';
  app.classList.add('file-over');
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) app.classList.remove('file-over');
});
window.addEventListener('drop', (e) => {
  app.classList.remove('file-over');
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  if (document.querySelector('.bp-overlay')) return; // hộp thoại khác đang mở (vd. hộp chọn công thức Modeler)
  const files = jsonFiles(e.dataTransfer.files);
  if (files.length === 0) return state.notify(tr('Chỉ nhận file bản vẽ .efp.json'));
  library(undefined, files);
});
// bản vẽ ghim trên thanh đặt máy thu gọn (người dùng 2026-10-02): Đặt / Mở như ở cửa sổ Bản vẽ
window.addEventListener(USE_BLUEPRINT_EVENT, (e) => {
  const b = loadLibrary().find((x) => x.id === (e as CustomEvent<string>).detail);
  if (b) void useBlueprint(state, renderer, b, confirmDialog);
});
// nút "Bản vẽ" của màn hình Modeler
window.addEventListener('efp:open-library', () => library());
const renderToolbar = mountDock(dock, state, renderer, {
  rightOpen: () => !app.classList.contains('right-collapsed'),
  toggleRight: () => {
    setRightOpen(app.classList.contains('right-collapsed'));
    state.emit('ui');
  },
  saveSelection: () => library('module'),
  openLibrary: () => library(),
});
/**
 * Phím tắt cấp cửa sổ (nhóm **Chung** của `keybinds.ts` — người dùng đổi được trong Cài đặt → Phím tắt): bảng chọn máy
 * (F1 / Z), cửa sổ máy (F2), bảng Tổng hợp (F3), lưu (Ctrl+S — đang chọn máy / nhóm máy ⇒ hộp lưu bản vẽ module, không
 * chọn gì ⇒ lưu cả map; Modeler ⇒ lưu sơ đồ), thư viện bản vẽ (Ctrl+Shift+S), thư viện công thức (L). Chạy cả ở Modeler.
 * Phím F / Ctrl+… luôn chặn mặc định của trình duyệt (trợ giúp, tìm, lưu trang); phím trơn thì nhường ô đang gõ chữ.
 */
const GLOBAL_KEYS = new Set(['palette', 'machineWin', 'summary', 'save', 'library', 'recipes']);
window.addEventListener('keydown', (e) => {
  const act = actionOf(e, ['general'], (a) => !GLOBAL_KEYS.has(a.id));
  if (!act) return;
  const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d/.test(e.key);
  if (plain && typingTarget(e)) return;
  e.preventDefault();
  if (document.body.classList.contains('modal-open') || e.repeat) return;
  if (act === 'palette') window.dispatchEvent(new Event('efp:toggle-palette'));
  else if (act === 'summary') {
    setRightOpen(app.classList.contains('right-collapsed'));
    state.emit('ui');
  } else if (act === 'machineWin') window.dispatchEvent(new Event(TOGGLE_MACHINE_WINDOW));
  else if (act === 'recipes') {
    if (!document.querySelector('.rl-overlay')) openRecipeLibrary(state);
  } else if (act === 'library') library();
  else if (act === 'save') {
    // màn hình Modeler: lưu sơ đồ vào tab "Modeler" của thư viện (Modeler đợt 4)
    if (app.classList.contains('modeler-mode')) return library('modeler');
    const picked = state.selection !== null || state.sel.machines.size > 0 || state.sel.tiles.size > 0;
    library(picked ? 'module' : 'map');
  }
});
// phím đổi trong Cài đặt → Phím tắt ⇒ dựng lại các nút (chú thích / nhãn phím trên nút đổi theo)
window.addEventListener(KEYBINDS_EVENT, () => state.emit('ui'));

// nút "Tổng hợp" của màn hình Modeler = F3
window.addEventListener('efp:toggle-summary', () => {
  setRightOpen(app.classList.contains('right-collapsed'));
  state.emit('ui');
});

const renderTopbar = mountTopbar(topbar, state, () => library());
const renderPalette = mountPalette(left, state, () => {
  // cột trái đổi bề rộng ⇒ canvas đổi cỡ; ResizeObserver bắt được, nhưng vẽ ngay cho khỏi nháy
  renderer.resize();
  renderer.draw();
});
const renderInspector = mountInspector(machineWin, state, fitSummary);
const renderSummary = mountSummary(summaryHost, state);

/** Bản đồ cần vẽ lại ở khung hình kế tiếp (xem `redraw`, `step`). */
let drawPending = false;

/**
 * Chỉ `'view'` mới bỏ qua phần dựng lại panel — di chuột phát tín hiệu vài chục lần
 * mỗi giây, dựng lại cả bảng chọn ở mỗi lần thì giao diện không theo kịp. Chọn máy và
 * đổi công cụ dùng `'ui'`: không cần giải lại nhưng **bắt buộc** phải dựng lại panel.
 */
function redraw(mode: EmitMode = 'data'): void {
  if (mode !== 'view') {
    renderToolbar();
    renderTopbar();
    renderPalette();
    renderInspector();
    renderSummary();
  }
  // chế độ Xoá (X): con trỏ chữ thập đỏ (người dùng 2026-10-02)
  canvas.classList.toggle('erase-mode', state.tool.kind === 'erase');
  if (tabMessage.textContent !== state.message) {
    tabMessage.textContent = state.message;
    tabMessage.title = state.message;
  }
  // **gom vẽ** (người dùng 2026-10-16, zoom + kéo liên tục trên map lớn bị giật): mỗi lần rê / kéo chuột trước đây vẽ lại
  // cả bản đồ ngay, rồi vòng lặp khung hình lại vẽ thêm trong cùng khung ⇒ 2–3 lần vẽ mỗi khung. Nay chỉ đánh dấu, khung
  // hình kế tiếp vẽ **một lần**
  drawPending = true;
}

state.subscribe(redraw);
const input = attachInput(canvas, state, renderer);
// chế độ chọn hàng loạt (X): khối phím tắt mảng trên + mảng dưới (người dùng 2026-10-06)
mountBatchHud(app, state, machineWin);
// hướng dẫn sử dụng theo từng bước (người dùng 2026-10-12)
mountTutorial(app, state, renderer);
// cảm ứng (app Android): cơ chế đặt / chọn / di chuyển máy và vẽ ống riêng cho ngón tay (`touchMap.ts`), thanh thao
// tác bên phải + thanh chế độ (`touchActions.ts`), kéo thả ở bảng chọn máy / thanh tab, chặn chạm ngoài khi mở bàn phím
if (touch) {
  const mapTouch = attachMapTouch(canvas, state, renderer, input);
  mountTouchActions(boardWrap, app, state, mapTouch, { saveSelection: () => library('module') });
  attachModelerTouch(modelerRoot);
  attachDragEmulation();
  attachKeyboardGuard();
  attachPanelSwipes(app);
  attachLayers();
  /**
   * Điện thoại (người dùng 2026-10-12): **5 s không chạm** ⇒ các nút lồi ra ở mép (tay kéo bảng Tổng hợp khi mở / đóng, nút
   * mũi tên của bảng chọn máy khi giấu hẳn, dải kéo của cột công cụ khi thu) mờ dần tới trong suốt, chỉ còn mũi tên; chạm
   * bất kỳ đâu ⇒ hiện lại ngay.
   */
  {
    let idle: ReturnType<typeof setTimeout> | null = null;
    const wake = (): void => {
      app.classList.remove('ui-idle');
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => app.classList.add('ui-idle'), 5000);
    };
    for (const t of ['touchstart', 'pointerdown', 'keydown'] as const) window.addEventListener(t, wake, { capture: true, passive: true });
    wake();
  }
  /**
   * Thanh tab trên điện thoại (người dùng 2026-10-12): dải chạm vô hình **ngay trên** thanh, cao bằng thanh ⇒ vùng chạm gấp
   * đôi (đáy màn hình dễ vướng cử chỉ hệ thống). Chạm ở đó = chạm vào tab / nút ngay bên dưới; vuốt ngang = cuộn thanh tab.
   */
  {
    const reach = el('div', { class: 'tb-reach' });
    tabBar.append(reach);
    let st: { x: number; y: number; sl: number; moved: boolean } | null = null;
    const stripEl = (): HTMLElement | null => tabBar.querySelector<HTMLElement>('.tb-strip');
    reach.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      st = t ? { x: t.clientX, y: t.clientY, sl: stripEl()?.scrollLeft ?? 0, moved: false } : null;
    }, { passive: true });
    reach.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (!st || !t) return;
      const dx = t.clientX - st.x;
      if (!st.moved && Math.abs(dx) < 8) return;
      st.moved = true;
      const s0 = stripEl();
      if (s0) s0.scrollLeft = st.sl - dx;
    }, { passive: true });
    reach.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      const d = st;
      st = null;
      if (!d || d.moved || !t) return;
      e.preventDefault(); // không để trình duyệt sinh thêm cú bấm ở chỗ dải chạm
      const r = tabBar.getBoundingClientRect();
      const under = document.elementFromPoint(t.clientX, r.top + r.height / 2);
      const hit = under?.closest<HTMLElement>('button, .tb-tab, .tb-group-name');
      if (hit && tabBar.contains(hit)) hit.click();
    });
  }
  /**
   * Điện thoại **màn dọc** (người dùng 2026-10-07): chỉ một trong ba cửa sổ chính — bảng chọn máy (mở rộng), bảng Tổng
   * hợp, cửa sổ Máy (mở) — được mở cùng lúc. Cửa sổ nào vừa mở ⇒ hai cửa sổ kia đóng bằng animation sẵn có của chúng (bảng
   * chọn máy thu gọn, Tổng hợp trượt ra mép phải, cửa sổ Máy thụt xuống thành nút thu gọn).
   */
  const mainOpen = (): Record<'palette' | 'summary' | 'machine', boolean> => ({
    palette: !app.classList.contains('palette-collapsed') && !app.classList.contains('palette-hidden'),
    summary: !app.classList.contains('right-collapsed'),
    machine: !machineWin.hidden && !machineWin.classList.contains('collapsed') && !machineWin.classList.contains('mw-closing') && !machineWin.classList.contains('mw-shrink'),
  });
  let lastOpen = mainOpen();
  const oneWindow = (): void => {
    const cur = mainOpen();
    const fresh = (['palette', 'summary', 'machine'] as const).find((k) => cur[k] && !lastOpen[k]);
    lastOpen = cur;
    if (!fresh || window.innerHeight <= window.innerWidth) return;
    if (fresh !== 'palette' && cur.palette) window.dispatchEvent(new Event('efp:toggle-palette'));
    if (fresh !== 'summary' && cur.summary) setRightOpen(false);
    if (fresh !== 'machine' && cur.machine) machineWin.querySelector<HTMLElement>('.mw-collapse')?.click();
  };
  new MutationObserver(oneWindow).observe(app, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(oneWindow).observe(machineWin, { attributes: true, attributeFilter: ['class', 'hidden'] });
  /**
   * Nút **Quay lại** của Android (gọi từ `MainActivity`): còn gì để huỷ (hộp thoại, máy đang cầm, vùng chọn, cửa sổ máy)
   * ⇒ làm như phím Esc, trả `true`; không còn gì ⇒ `false` và app lui về nền (không đóng, giữ nguyên trạng thái).
   */
  (window as unknown as { efpBack: () => boolean }).efpBack = (): boolean => {
    const busy =
      // thư viện công thức đang mở: Esc = lùi một màn / đóng (người dùng 2026-10-07)
      !!document.querySelector('.bp-overlay, .rl-overlay, .tb-menu, .set-menu') ||
      state.tool.kind !== 'select' ||
      state.selection !== null ||
      state.sel.machines.size > 0 ||
      state.sel.tiles.size > 0;
    if (!busy) return false;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); // đóng menu nổi (Cài đặt…) như bấm ra ngoài
    return true;
  };
}

/**
 * Vòng lặp khung hình: camera trượt mượt (zoom tiệm cận đích, phím WASD chạy với tốc
 * độ cố định). Chỉ vẽ lại khi có gì thay đổi, nên đứng yên thì gần như không tốn gì.
 */
let lastFrame = performance.now();
function step(dt: number): void {
  // chế độ Simulation: chạy tiếp rồi vẽ lại mỗi khung hình (Map thường thì chỉ vẽ khi có gì đổi)
  if (tickSimMode(dt)) redraw('view');
  const zoomed = renderer.camera.update(dt);
  const moved = input.tick(dt);
  if (zoomed) input.refreshHover();
  if (zoomed || moved) {
    redraw('view');
    zoneClock = 0;
  } else if (renderer.animating()) {
    // viền vùng phủ nét đứt chạy vòng: vẽ lại ~30 khung/giây khi có vùng nào đang hiện
    zoneClock += dt;
    if (zoneClock >= 1 / 30) {
      zoneClock = 0;
      drawPending = true;
    }
  }
  if (drawPending) {
    drawPending = false;
    renderer.draw();
  }
}
let zoneClock = 0;
function frame(now: number): void {
  step(Math.min(0.05, (now - lastFrame) / 1000));
  lastFrame = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Kích thước canvas chỉ đúng sau khi trình duyệt bố cục xong; ResizeObserver bắt
// được cả lần đầu lẫn khi người dùng kéo cửa sổ, nên không cần đoán thời điểm.
let fitted = false;
const observer = new ResizeObserver(() => {
  const changed = renderer.resize();
  if (!changed && fitted) return;
  if (!fitted && canvas.clientWidth > 0) {
    renderer.fit();
    fitted = true;
  }
  redraw('view');
  // đổi cỡ canvas = trình duyệt xoá trắng nó; hẹn vẽ ở khung sau thì khung này lên màn hình **trống** ⇒ suốt lúc bảng chọn
  // máy / thanh bên trượt ra vào (mỗi khung một lần đổi cỡ) màn hình đen (người dùng 2026-10-26). ResizeObserver chạy
  // sau bố cục, trước khi vẽ lên màn hình ⇒ vẽ ngay tại đây.
  if (changed) {
    drawPending = false;
    renderer.draw();
  }
});
observer.observe(canvas);

renderer.resize();
renderer.fit();
redraw();

// ------------------------------------------------------------------ thanh tab
let unmountModeler: (() => void) | null = null;
const tabs = new TabManager(
  state,
  {
    onActivate(tab, first) {
      window.dispatchEvent(new Event(CHECKLIST_REFRESH));
      // đổi tab không làm mất tiến độ mô phỏng (người dùng 2026-10-03): tab / nhóm có phiên mô phỏng ⇒ hiện lại đúng chỗ
      simTabActivated(tab);
      const modeler = tab.kind === 'modeler';
      app.classList.toggle('modeler-mode', modeler);
      renderPalette(); // bảng chọn máy dùng chung: bên Modeler máy không dùng được thì ẩn / mờ đi
      // hộp hướng dẫn góc phải dưới, mỗi lần bật tab — nội dung riêng Map / Modeler (người dùng 2026-09-30)
      // "Không hiện tooltip" (Cài đặt) tắt luôn hộp hướng dẫn tự hiện khi đổi tab (*suy luận* 2026-10-05)
      if (!prefs().noTooltips) showHints(app, touch ? (modeler ? TOUCH_MODELER_HINTS : TOUCH_MAP_HINTS) : modeler ? MODELER_HINTS() : MAP_HINTS());
      unmountModeler?.();
      unmountModeler = null;
      if (modeler) {
        // màn hình sơ đồ Modeler (đợt 2: vẽ sơ đồ; đợt 3 mới tính toán)
        tab.modeler ??= emptyModeler();
        unmountModeler = mountModeler(modelerRoot, {
          state,
          doc: tab.modeler,
          onChange: () => {
            tabs.persistSoon();
            renderTabBar();
            window.dispatchEvent(new Event(CHECKLIST_REFRESH));
          },
          notify: (text) => state.notify(text),
        });
        return;
      }
      const cam = tab.map?.camera;
      renderer.resize();
      if (cam) {
        const c = renderer.camera;
        c.x = cam.x;
        c.z = cam.z;
        c.cell = c.targetCell = cam.cell;
        c.turns = cam.turns;
        c.spin = 0;
        state.viewTurns = cam.turns;
        fitted = true;
      } else if (!first || canvas.clientWidth > 0) {
        renderer.camera.turns = 0;
        renderer.camera.spin = 0;
        state.viewTurns = 0;
        renderer.fit();
      }
      redraw('view');
    },
    camera: () => {
      const c = renderer.camera;
      return { x: c.x, z: c.z, cell: c.targetCell, turns: c.turns };
    },
    confirm: (text, ok) => confirmDialog(text, ok, 'close-tab'),
    changed: () => renderTabBar(),
    leaving: () => simTabLeaving(),
    groupsChanged: () => simGroupsChanged(),
  },
  initialTabs,
);
// chế độ Simulation: cần thanh tab (nhóm map mô phỏng chung, mỗi tab / nhóm một phiên)
mountSimMode({ state, renderer, app, host: boardWrap, right, redraw: () => redraw('view'), tabs });
const renderTabBar = mountTabBar(tabsHost, tabs);
// Checklist dây chuyền (người dùng 2026-10-12): nút góc dưới trái bản đồ, cả Map lẫn Modeler
mountChecklist(app, state, tabs);
// chuột giữa lên icon vật phẩm / môi trường ⇒ trang thư viện của nó (người dùng 2026-10-13)
mountItemLinks(state);
// giữ Alt ⇒ hiện phím tắt ở góc các nút (người dùng 2026-10-13)
if (!touch) mountShortcutBadges();
tabs.start();
// lưu mọi tab mỗi khi bản vẽ đổi (đặt, xoá, hoàn tác…); lúc đóng trang thì lưu ngay. `efp:map` vẫn
// giữ bản sao của map đang mở (định dạng cũ, dự phòng).
state.subscribe((mode) => {
  if (mode !== 'data') return;
  // lần sửa đầu tiên: xin trình duyệt giữ dữ liệu lâu dài (không tự dọn khi thiếu chỗ)
  requestPersistentStorage();
  tabs.persistSoon();
  renderTabBar(); // dấu ● "chưa lưu"
  if (!app.classList.contains('modeler-mode')) scheduleAutosave(() => ({ bp: state.bp, terrain: state.terrain }));
});
/**
 * Lưu ngay mọi tab: lúc đóng trang **và lúc app xuống nền** (rà soát 2026-10-14) — Android / WebView, Safari iOS thường
 * không gửi `beforeunload` khi hệ điều hành tắt app đang ở nền, nhưng luôn gửi `visibilitychange` / `pagehide`.
 */
const flushAll = (): void => {
  tabs.persistNow();
  if (tabs.active.kind === 'map') saveNow({ bp: state.bp, terrain: state.terrain });
};
window.addEventListener('beforeunload', flushAll);
window.addEventListener('pagehide', flushAll);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushAll();
});
// cửa sổ Bản vẽ vừa thay / lưu map của tab đang mở ⇒ đổi tên tab, bỏ dấu "chưa lưu"
window.addEventListener(DOC_EVENT, (e) => tabs.describeActive((e as CustomEvent<{ title?: string; saved?: boolean }>).detail));
// cửa sổ Bản vẽ mở một sơ đồ Modeler đã lưu ⇒ tab Modeler mới
// Thư viện công thức (nút ba cuốn sách ở đầu bảng chọn máy — người dùng 2026-10-06)
window.addEventListener(OPEN_RECIPES_EVENT, () => openRecipeLibrary(state));
window.addEventListener(OPEN_MODELER_EVENT, (e) => {
  const d = (e as CustomEvent<{ title: string; doc: ModelerDoc }>).detail;
  tabs.openModeler(d.title, d.doc);
});

// Móc debug: tiện khi chỉnh tay trong console, không ảnh hưởng gì tới ứng dụng.
// `step` cho phép chạy tay một khung hình — trình duyệt dừng requestAnimationFrame khi
// tab bị ẩn, lúc đó vẫn kiểm được chuyển động camera.
(window as unknown as Record<string, unknown>).__planner = { state, renderer, step, tabs };
