# Endfield AIC Planner

A fan-made factory planner for the **AIC** (Automated Industry Complex) of *Arknights: Endfield*.
Plan a base on a grid, let belts and pipes route themselves, see the throughput of every machine,
and simulate the factory over time — in the browser, as a Windows app, or on an Android phone.

> Fan-made tool, **not affiliated with or endorsed by Hypergryph / Gryphline**. See [NOTICE](NOTICE).

*Tiếng Việt: xem [bên dưới](#tiếng-việt).*

## Features

- **Map planner** — two-layer grid editor (ground / elevated) with the real machine footprints and ports,
  auto-routing for belts and pipes (bridges at crossings, splitters / mergers / control ports), rotation,
  multi-select, copy / paste, undo / redo, map tabs and tab groups.
- **Throughput solver** — rates per machine and per line, belt / pipe capacity, backpressure, power supply
  and pylon range, activator gas, catalyst environments, depot (core) input / output.
- **Simulation** — time-based simulation of the whole map (or a group of maps sharing depot and power):
  precomputed up to 24 h, timeline you can scrub, production / depot charts, per-machine state, blackout when
  power runs out.
- **Modeler** — a Satisfactory-Modeler-style node graph: machines + recipes as nodes, demand propagated
  backwards, partial machines shown in %, flow limits on pipes, crucibles that scale with demand.
- **Recipe library** — every item with its sources and uses, production chains from raw materials, and
  "Modelize" to turn a chain into a Modeler graph.
- **Blueprint library** — save modules, whole maps and Modeler graphs; import / export as `.efp.json`.
- **Platforms** — web, Windows desktop app (Tauri), Android app (Capacitor, touch UI); Vietnamese and English.
- **Background music** — pick your own MP3 in Settings (stored only in your browser / app).

## Install

Download from the [latest release](https://github.com/nhathuy29102002/endfield-builder/releases/latest), or use the
web version at <https://endfieldbuilder.pages.dev> (nothing to install).

| | Windows | Android | Web |
|---|---|---|---|
| File | `EndfieldAICPlanner-setup.exe` (installer) or `EndfieldAICPlanner.exe` (portable) | `EndfieldAICPlanner.apk` | — |
| Requires | Windows 10 / 11, 64-bit; Microsoft Edge **WebView2** runtime | Android **7.0** or newer (API 24) | Chrome / Edge / Firefox / Safari from the last 2 years |
| Admin rights | not needed (installs for the current user) | — | — |

**Windows**

1. Run `EndfieldAICPlanner-setup.exe`. It installs for your user only and adds Start-menu / desktop shortcuts.
   If WebView2 is missing (rare on Windows 11 and up-to-date Windows 10) the installer downloads it, so keep the PC
   online the first time.
2. The portable `EndfieldAICPlanner.exe` runs without installing, but needs WebView2 already present.
3. The app is not code-signed, so SmartScreen may say "Windows protected your PC": click **More info → Run anyway**.
4. Updating: run the new installer over the old one — your maps and library are kept.

**Android**

1. Download `EndfieldAICPlanner.apk` on the phone and open it. Allow "Install unknown apps" for the browser / file
   manager when Android asks.
2. Updating: install the new APK over the old one. If Android says the package **conflicts**, the installed copy was
   signed with a different key (for example a debug build): export your work first (**Blueprints** window → **Export**), uninstall,
   then install — uninstalling deletes the app's data.
3. Play Protect may warn about an unknown developer: choose **Install anyway**.

**Where your data lives** — maps, tabs and the blueprint library are stored on the device (browser storage /
app storage); each browser and each app install has its own copy. Use the **Blueprints** window → Export / Import
(`.efp.json`) to move
or back up your work.

## Run it locally

Requires [Node.js](https://nodejs.org/) 22+ (Capacitor 8 needs it; CI uses Node 22).

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (vitest)
npm run build        # static site in dist/
npm run build:public # public build
```

The app is a static site: `dist/` can be served by any static host.

### Desktop app (Windows)

Uses [Tauri 2](https://tauri.app/) — needs Rust and the Visual Studio C++ Build Tools.
`tools\build-app-windows.cmd` builds `src-tauri\target\release\EndfieldAICPlanner.exe` and an NSIS installer.

### Android app

Uses [Capacitor](https://capacitorjs.com/) — needs the Android SDK and JDK 21.

```bash
npx vite build
npx cap sync android
cd android && ./gradlew assembleDebug
```

## Data and credits

- All game assets © Hypergryph / Gryphline. The MIT licence of this repository covers the source code only —
  see [NOTICE](NOTICE).

## License

Source code: [MIT](LICENSE). Game assets: see [NOTICE](NOTICE).

---

## Tiếng Việt

Công cụ quy hoạch nhà máy **AIC** cho *Arknights: Endfield* do fan làm — **không liên kết với Hypergryph / Gryphline**.

- **Map:** đặt máy trên lưới 2 tầng, băng chuyền / ống tự tìm đường, tính thông lượng, điện, chất kích hoạt,
  môi trường xúc tác, kho tổng.
- **Mô phỏng:** chạy nhà máy theo thời gian (tới 24 giờ), tua lại, biểu đồ sản lượng.
- **Modeler:** sơ đồ nút kiểu Satisfactory Modeler, tự tính số máy theo nhu cầu.
- **Thư viện công thức** và **thư viện bản vẽ** (nhập / xuất `.efp.json`).
- Chạy trên **web**, **Windows** (exe) và **Android**; tiếng Việt và tiếng Anh.
- **Nhạc nền:** tự chọn file MP3 của bạn trong Cài đặt.

### Cài đặt

Tải ở [bản phát hành mới nhất](https://github.com/nhathuy29102002/endfield-builder/releases/latest), hoặc dùng bản web
<https://endfieldbuilder.pages.dev> (không cần cài).

- **Windows** (Windows 10 / 11, 64-bit):
  - `EndfieldAICPlanner-setup.exe` cài cho riêng tài khoản của bạn, không cần quyền quản trị. Máy thiếu **WebView2**
    (hiếm gặp trên Windows 11 và Windows 10 đã cập nhật) thì bộ cài tự tải về, nên lần đầu cần có mạng.
  - `EndfieldAICPlanner.exe` chạy luôn không cần cài, nhưng máy phải có sẵn WebView2.
  - App chưa ký số nên SmartScreen có thể báo "Windows protected your PC": bấm **More info → Run anyway**.
  - Cập nhật: chạy bộ cài mới đè lên bản cũ; map và thư viện được giữ nguyên.
- **Android** (Android **7.0** trở lên):
  - Mở file `EndfieldAICPlanner.apk` trên điện thoại; khi Android hỏi thì cho phép "Cài ứng dụng không rõ nguồn gốc"
    với trình duyệt / trình quản lý file. Play Protect cảnh báo nhà phát triển lạ thì chọn **Vẫn cài đặt**.
  - Cập nhật: cài APK mới đè lên. Nếu Android báo **xung đột gói** (bản đang cài được ký bằng khoá khác, ví dụ bản
    debug), hãy vào cửa sổ **Bản vẽ → Xuất** trước, gỡ app rồi cài lại — gỡ app sẽ xoá dữ liệu của app.
- **Dữ liệu** (map, tab, thư viện bản vẽ) lưu ngay trên thiết bị; mỗi trình duyệt / mỗi bản cài có kho riêng. Dùng
  cửa sổ **Bản vẽ → Xuất / Nhập** (`.efp.json`) để chuyển máy hoặc sao lưu.

Chạy thử trên máy: cài Node.js 22+, rồi `npm install` và `npm run dev`.

Mã nguồn theo giấy phép MIT; hình ảnh, dữ liệu và âm thanh của game thuộc Hypergryph / Gryphline (xem NOTICE).
