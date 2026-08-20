# Onionskin promo site

A single self-contained page. Colour comes from the editor's own theme tokens,
so the site can wear any of Onionskin's eleven palettes — and the theme picker in
the Themes section is the real thing, not a mock-up.

## Building

```bash
node website/build.mjs
```

That reads `src/styles/base.css` and `src/styles/themes.css`, merges each theme
into a complete token set, and writes:

| File | What it is |
| --- | --- |
| `index.html` | Standalone page. Screenshots inlined as data URIs, so it opens straight from disk or from any static host. |
| `artifact.html` | The same page as a fragment, for publishing as a Claude artifact. |
| `palettes.css` | The generated token block, kept for reference. |

Edit `src/page.html` — never the generated files. Re-run the build after
changing a theme in the app and the site follows automatically.

## Hosting

Copy `index.html` to any static host. To make the download button work, put the
installer next to it:

```bash
cp src-tauri/target/release/bundle/msi/Onionskin_0.1.0_x64_en-US.msi website/
```

The installer is deliberately not committed — it is a 3.4 MB binary that would
bloat the repository, and it is rebuilt by `npm run app:build` anyway.

## Screenshots

`shots/*.png` are real captures of the release build at 1366×873, taken against
a demo vault. To retake them, build the release binary, stage a document, and
capture the window with `DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS)`
— `GetWindowRect` includes the invisible resize border and captures a strip of
whatever is behind the window.
