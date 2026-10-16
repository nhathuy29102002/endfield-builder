import { tr } from '../i18n';
import { el, clear } from './dom';
import {
  ACTIONS,
  LOCKED_ROWS,
  bindings,
  comboLabel,
  comboOfKey,
  comboOfMouse,
  conflictsOf,
  isCustom,
  isModifierKey,
  resetBindings,
  setBinding,
  type ActionDef,
  type Combo,
  type Scope,
} from '../keybinds';
import { hotkeyOf } from '../editor/keys';

/**
 * Cửa sổ **Phím tắt** (Cài đặt → Phím tắt, người dùng 2026-10-13): 3 tab Chung / Map / Modeler. Mỗi thao tác một dòng
 * với hai ô phím (chính, phụ):
 *  - bấm ô ⇒ "Bấm phím…" ⇒ bấm tổ hợp mới (Ctrl / Shift / Alt + phím; phím bổ trợ một mình thì nhả ra là nhận); Esc huỷ;
 *  - chuột phải lên ô ⇒ bỏ phím đó; ↺ cuối dòng ⇒ về mặc định;
 *  - phím trùng với thao tác khác (cùng tab hoặc tab Chung, cùng hoàn cảnh) ⇒ ô có dấu **!** đỏ, rê chuột xem trùng với gì;
 *    tab nào có chỗ trùng thì tên tab cũng có dấu !;
 *  - thao tác chuột hiện ổ khoá, không đổi được — trừ "mở thư viện của vật phẩm" (gán được nút chuột).
 */
const SCOPES: [Scope, () => string][] = [
  ['general', () => tr('Chung')],
  ['map', () => 'Map'],
  ['modeler', () => 'Modeler'],
];
const scopeName = (s: Scope): string => SCOPES.find(([k]) => k === s)![1]();

let lastTab: Scope = 'general';

export function openKeybinds(): void {
  if (document.querySelector('.kb-dialog')) return;
  let tab: Scope = lastTab;
  /** Ô đang chờ phím: thao tác + ô thứ mấy. */
  let capture: { id: string; slot: 0 | 1 } | null = null;
  /** Phím bổ trợ đang giữ trong lúc chờ (nhả ra mà chưa bấm phím khác ⇒ gán chính nó). */
  let pendingMod: string | null = null;

  const overlay = el('div', { class: 'bp-overlay kb-overlay' });
  const tabs = el('div', { class: 'kb-tabs', role: 'tablist' });
  const list = el('div', { class: 'kb-list' });
  const close = (): void => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('mousedown', onMouse, true);
    window.removeEventListener('contextmenu', onContext, true);
    overlay.remove();
    if (!document.querySelector('.bp-overlay')) document.body.classList.remove('modal-open');
  };

  const assign = (combo: Combo | null): void => {
    if (!capture) return;
    const { id, slot } = capture;
    capture = null;
    pendingMod = null;
    setBinding(id, slot, combo);
    render();
  };
  const stopCapture = (): void => {
    capture = null;
    pendingMod = null;
    render();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (!capture) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    const key = hotkeyOf(e);
    if (!key) return;
    if (key === 'escape' && !e.ctrlKey && !e.shiftKey && !e.altKey) return stopCapture();
    if (isModifierKey(key)) {
      pendingMod = key === 'meta' ? 'control' : key;
      return;
    }
    pendingMod = null;
    assign(comboOfKey(e));
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (!capture) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const key = hotkeyOf(e);
    if (pendingMod && (key === pendingMod || (pendingMod === 'control' && key === 'meta'))) assign({ key: pendingMod });
  };
  /** Đang chờ phím của thao tác gán được nút chuột ⇒ bấm chuột (trái phải kèm phím bổ trợ) là gán. */
  const onMouse = (e: MouseEvent): void => {
    if (!capture) return;
    const a = ACTIONS.find((x) => x.id === capture!.id);
    // bấm sang một ô khác ⇒ để `click` của ô đó chọn ô mới (không dựng lại trước khi click tới)
    const onChip = (e.target as Element | null)?.closest?.('.kb-chip:not(.locked)');
    if (a?.mouse && (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      assign(comboOfMouse(e));
      return;
    }
    // bấm ra ngoài các ô ⇒ thôi chờ
    if (!onChip) stopCapture();
  };
  const onContext = (e: MouseEvent): void => {
    if (capture && ACTIONS.find((x) => x.id === capture!.id)?.mouse) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  /** Số chỗ trùng trong một tab (để gắn ! lên tên tab). */
  const clashesIn = (scope: Scope): number =>
    ACTIONS.filter((a) => a.scope === scope).reduce((n, a) => n + bindings(a.id).filter((c) => conflictsOf(a.id, c).length > 0).length, 0);

  const chip = (a: ActionDef, slot: 0 | 1): HTMLElement => {
    const c = bindings(a.id)[slot];
    const waiting = capture?.id === a.id && capture.slot === slot;
    const clash = waiting ? [] : conflictsOf(a.id, c);
    const b = el(
      'button',
      {
        type: 'button',
        class: `kb-chip${c ? '' : ' empty'}${waiting ? ' wait' : ''}${clash.length ? ' clash' : ''}`,
        title: clash.length
          ? tr('Trùng phím với: {0}', clash.map((x) => `${x.label()} (${scopeName(x.scope)})`).join(', '))
          : waiting
            ? a.mouse
              ? tr('Bấm phím hoặc nút chuột (chuột trái phải kèm Ctrl / Shift / Alt) — Esc để huỷ')
              : tr('Bấm phím mới — Esc để huỷ')
            : tr('Bấm để đổi phím · chuột phải để bỏ phím này'),
        onclick: (e: Event) => {
          e.stopPropagation();
          capture = { id: a.id, slot };
          pendingMod = null;
          render();
        },
        oncontextmenu: (e: Event) => {
          e.preventDefault();
          if (capture) return;
          setBinding(a.id, slot, null);
          render();
        },
      },
      waiting ? tr('Bấm phím…') : c ? comboLabel(c) : '—',
    );
    if (clash.length) b.append(el('span', { class: 'kb-bang', 'aria-hidden': 'true' }, '!'));
    return b;
  };

  const render = (): void => {
    lastTab = tab;
    clear(tabs);
    for (const [s, name] of SCOPES) {
      const n = clashesIn(s);
      tabs.append(
        el(
          'button',
          { type: 'button', role: 'tab', class: `kb-tab${s === tab ? ' on' : ''}`, onclick: () => ((tab = s), (capture = null), render()) },
          name(),
          n ? el('span', { class: 'kb-tab-bang', title: tr('Có phím bị trùng') }, '!') : null,
        ),
      );
    }
    clear(list);
    list.append(
      el('div', { class: 'kb-row kb-head' }, el('span', {}, tr('Thao tác')), el('span', {}, tr('Phím chính')), el('span', {}, tr('Phím phụ')), el('span', {})),
    );
    for (const a of ACTIONS.filter((x) => x.scope === tab))
      list.append(
        el(
          'div',
          { class: 'kb-row' },
          el('span', { class: 'kb-label' }, a.label()),
          chip(a, 0),
          chip(a, 1),
          isCustom(a.id)
            ? el('button', { type: 'button', class: 'kb-reset', title: tr('Về phím mặc định'), onclick: () => (setBinding(a.id, 0, a.def[0]), setBinding(a.id, 1, a.def[1]), render()) }, '↺')
            : el('span', {}),
        ),
      );
    const locked = LOCKED_ROWS.filter((r) => r.scope === tab);
    if (locked.length) {
      list.append(el('div', { class: 'kb-sub' }, tr('Chuột (không đổi được)')));
      for (const r of locked) {
        const [k1, k2] = r.keys();
        const lockChip = (t?: string): HTMLElement =>
          t ? el('span', { class: 'kb-chip locked', title: tr('Thao tác chuột — không đổi được') }, '🔒 ' + t) : el('span', { class: 'kb-chip locked empty' }, '—');
        list.append(el('div', { class: 'kb-row locked' }, el('span', { class: 'kb-label' }, r.label()), lockChip(k1), lockChip(k2), el('span', {})));
      }
    }
  };

  overlay.append(
    el(
      'div',
      { class: 'bp-dialog kb-dialog', role: 'dialog' },
      el(
        'div',
        { class: 'bp-dialog-title kb-title' },
        el('span', {}, tr('Phím tắt')),
        el('button', { type: 'button', class: 'bp-close', title: tr('Đóng (Esc)'), onclick: () => close() }, '×'),
      ),
      tabs,
      list,
      el(
        'div',
        { class: 'kb-foot' },
        el('span', { class: 'kb-note' }, tr('Bấm ô để đổi phím · chuột phải để bỏ · ! = trùng phím trong tab này hoặc tab Chung')),
        el('button', { type: 'button', class: 'tool', onclick: () => (resetBindings(tab), (capture = null), render()) }, tr('Khôi phục mặc định (tab này)')),
      ),
    ),
  );
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay && !capture) close();
  });
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('mousedown', onMouse, true);
  window.addEventListener('contextmenu', onContext, true);
  document.body.append(overlay);
  document.body.classList.add('modal-open');
  render();
}
