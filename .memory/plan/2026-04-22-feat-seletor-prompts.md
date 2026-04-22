# Plan: Seletor de Prompts
**Date:** 2026-04-22
**Confidence:** 4 / 5

---

## 1. Overview

Add a new tool page (`seletor-prompts.html`) that lets a user:
1. Search a person by name via Notion autocomplete (identical to `minibio.html`).
2. Select one of 6 prompt cards (radio-style), each showing a static preview image and a label.
3. Click Generate → sends the person's Notion photo as reference image + the selected prompt to Freepik → polls until complete → renders raw result on a `<canvas>` → offers a download button.

No canvas text overlay is needed; the page just shows the raw AI image.

---

## 2. Files to Create

### 2.1 `seletor-prompts.html` (~380 LOC)

The only new HTML/JS file. Self-contained (inline `<style>` + `<script>`, matching the pattern of every other tool page).

**Sections:**

| Section | Description |
|---|---|
| `<head>` | Same font-face declarations, CSS variables, and `sessionStorage` PIN guard as `minibio.html` |
| `.tool-nav` | Fixed top nav — same markup as `minibio.html`; `active` class on "Seletor de Prompts" |
| `header` | Teal rule + title "Seletor de Prompts" + subtitle |
| `.card` (form) | Notion person search (autocomplete) + prompt grid + Generate button |
| `.prompt-grid` | 2 × 3 CSS Grid of 6 `.prompt-card` elements (see below) |
| `.result` | Canvas + Download button (hidden until generation completes) |
| `<script>` | All logic: autocomplete, prompt selection, Freepik generation, polling, canvas draw |

**Prompt card markup (repeated × 6):**

```html
<div class="prompt-card" data-index="1">
  <img class="prompt-preview" src="/assets/prompt-previews/prompt-1.jpg" alt="Prompt 1" />
  <div class="prompt-info">
    <div class="prompt-name">Estilo 1</div>   <!-- label user will fill in later -->
    <div class="prompt-check"></div>           <!-- teal checkmark when selected -->
  </div>
</div>
```

**Prompt text placeholders (in `<script>`):**

```js
const PROMPTS = [
  { label: 'Estilo 1', text: 'Professional executive power portrait for Rede Líderes. Use the uploaded photo as face and identity reference — replicate the person's exact appearance, clothing, and posture exactly as shown in the photo. ABSOLUTE PHYSICAL FIDELITY: replicate the subject's exact body shape, weight, build, clothing, and silhouette with zero alteration — do NOT change, slim, or idealise anything. Dead-center frontal bust. Chin slightly forward, eyes locked intensely into lens. No smile. Quiet authority. Background: solid pure white (#FFFFFF), clean, flat, seamless — optimised for background removal. Single large umbrella overhead — butterfly pattern, shadow directly beneath nose. Teal rim light (#03d8d2) barely tracing both shoulder edges. Cinematic grade: teal-green shadow cast preserving skin warmth, crushed highlights. Ultra-realistic photography, hyper-realistic skin texture, authentic imperfections preserved — zero smoothing. 4:5 vertical. CRITICAL: NO text overlays, NO watermarks, NO labels, NO logos. Clean photograph only. No visible lighting equipment, no overhead gear, no ceiling in frame. Camera stays at or below eye level. Subject must look naturally present — NOT pasted or composited.' },
  { label: 'Estilo 2', text: 'Professional executive portrait for Rede Líderes. Use the uploaded photo as face and identity reference — replicate the person's exact appearance, clothing, and posture exactly as shown. ABSOLUTE PHYSICAL FIDELITY: zero alteration to body, clothing, weight, or silhouette. 2/3 body frame, frontal, hands at sides or one hand in pocket. Full commanding presence. Background: solid pure white (#FFFFFF), clean, flat, seamless — optimised for background removal. Two-light: large overhead key + subtle fill camera-right. Teal rim light (#03d8d2) both shoulders. Teal-green shadow cast, cinematic grade. Ultra-realistic photography, hyper-realistic skin texture — zero smoothing. 4:5 vertical. CRITICAL: NO text overlays, NO watermarks, NO logos. Clean photograph only. No visible lighting equipment, no ceiling in frame.' },
  { label: 'Estilo 3', text: 'Professional executive editorial portrait for Rede Líderes. Use the uploaded photo as face and identity reference — replicate the person's exact appearance, clothing, and posture exactly as shown. ABSOLUTE PHYSICAL FIDELITY: zero alteration to body, clothing, or silhouette. Head-and-shoulders editorial frame — upper chest to crown, spacious proportions. Face slightly angled 15° toward light. Expression: composed, effortlessly confident. Background: solid pure white (#FFFFFF), clean, flat, seamless — optimised for background removal. Large softbox camera-left 45°, feathered and soft. Teal rim light (#03d8d2) tracing collar and shoulder edge. Teal-green shadow cast, cinematic grade. Ultra-realistic photography, hyper-realistic skin texture — zero smoothing. 4:5 vertical. CRITICAL: NO text overlays, NO watermarks, NO logos. Clean photograph only. No visible lighting equipment, no ceiling in frame.' },
  { label: 'Estilo 4', text: 'Professional executive portrait for Rede Líderes. Use the uploaded photo as face and identity reference — replicate the person's exact appearance, clothing, and posture exactly as shown. ABSOLUTE PHYSICAL FIDELITY: zero alteration to body, clothing, or silhouette. Body turned 30° right, head returning to camera. Rembrandt triangle of light on left shadow-side cheek. Right jaw exposed. Eyes hold camera with authority. Background: solid pure white (#FFFFFF), clean, flat, seamless — optimised for background removal. Rembrandt key camera-left 45° upper, 3:1 ratio. Hard teal rim light (#03d8d2) from behind-right tracing right jaw and shoulder. Teal-green shadow cast, cinematic grade. Ultra-realistic photography, hyper-realistic skin texture — zero smoothing. 4:5 vertical. CRITICAL: NO text overlays, NO watermarks, NO logos. Clean photograph only. No visible lighting equipment, no ceiling in frame.' },
  { label: 'Estilo 5', text: 'Professional executive seated portrait for Rede Líderes. Use the uploaded photo as face and identity reference — replicate the person's exact appearance, clothing, and posture exactly as shown. ABSOLUTE PHYSICAL FIDELITY: zero alteration to body, clothing, or silhouette. Seated in a deep brown leather Chesterfield armchair. Body leaning slightly forward, forearms on armrests, hands loosely clasped. Direct intense gaze into lens. No smile. Grounded and dominant. Background: solid pure white (#FFFFFF), clean, flat, seamless — optimised for background removal. Overhead umbrella — butterfly shadow under nose. Cold teal rim light (#03d8d2) ambient behind. No equipment visible, camera below ceiling. Teal-green shadow cast, cinematic grade. Ultra-realistic photography, hyper-realistic skin texture — zero smoothing. 4:5 vertical. CRITICAL: NO text overlays, NO watermarks, NO logos. Clean photograph only.' },
  { label: 'Estilo 6', text: 'Professional contemplative executive portrait for Rede Líderes. Use the uploaded photo as face and identity reference — replicate the person's exact appearance, clothing, and posture exactly as shown. ABSOLUTE PHYSICAL FIDELITY: zero alteration to body, clothing, or silhouette. Camera slightly above eye line, 3/4 angle. Eyes 30° left of lens — gaze into distance, thinking. Hand near jaw or temple, natural touch. Expression: depth, quiet power. Background: solid pure white (#FFFFFF), clean, flat, seamless — optimised for background removal. Strip softbox camera-right directional. Deep shadow on left side. Teal rim hairlight (#03d8d2) from directly above tracing crown. Teal-green shadow cast, cinematic grade. Ultra-realistic photography, hyper-realistic skin texture — zero smoothing. 4:5 vertical. CRITICAL: NO text overlays, NO watermarks, NO logos. Clean photograph only. No visible lighting equipment, no ceiling in frame.' },
];
```

**JS logic blocks (mirroring `minibio.html`):**

| Block | Key details |
|---|---|
| Notion autocomplete | Debounced `fetch('/api/notion/search?q=')` → dropdown → on select, call `loadNotionPhoto(url)` |
| `loadNotionPhoto(url)` | `fetch('/api/proxy-image?url=')` → blob → `FileReader` → dataURL stored in `notionPhotoDataUrl` |
| Prompt selection | Click on `.prompt-card` → set `selectedPromptIndex`, toggle `.selected` class (radio pattern) |
| Generate guard | Button disabled unless `notionPhotoDataUrl` and `selectedPromptIndex !== null` |
| `generate()` | Resize photo to 512 × 512 on off-screen canvas → base64 → `POST /api/generate` with `{ prompt: PROMPTS[i].text, reference_images: [{image, mime_type}], aspect_ratio: '1:1', guidance_scale: 7 }` |
| Polling | `setInterval` every 3 s → `GET /api/generate/:taskId` → on `COMPLETED` draw image URL proxied via `/api/proxy-image` onto visible canvas |
| Canvas draw | `drawImage` filling the full canvas (no text overlay) |
| Download | `canvas.toBlob` → object URL → programmatic `<a>` click |

---

### 2.2 `assets/prompt-previews/` (directory + 6 placeholder images)

**Path:** `c:\Users\enzop\Desktop\OneRepo\gerador-de-imagem\assets\prompt-previews\`

Files expected at runtime:
```
prompt-1.jpg
prompt-2.jpg
prompt-3.jpg
prompt-4.jpg
prompt-5.jpg
prompt-6.jpg
```

These are static pre-generated example images supplied by the user. The code references them as `/assets/prompt-previews/prompt-N.jpg`. The directory must exist before first deploy; placeholder images (e.g. a dark 400×400 solid) should be added so the page does not show broken image icons during development.

**Action:** Create the directory. Add 6 minimal placeholder images (or note in a `README-placeholders.txt` that real images must be placed here). No automated generation needed.

---

## 3. Files to Modify

### 3.1 `app.html` — add hub card (~35 LOC added)

**Where:** Inside `<div class="tools">`, after the last existing `<a class="tool-card">` block (currently CopyWriter, line ~399).

**What to add:**

```html
<!-- Seletor de Prompts -->
<a class="tool-card" href="/seletor-prompts.html">
  <div class="tool-preview">
    <div class="mock-seletor">
      <!-- 6 mini prompt tiles in a 2x3 grid mockup -->
      <div class="mock-seletor-grid">
        <div class="mock-tile mock-tile--active"></div>
        <div class="mock-tile"></div>
        <div class="mock-tile"></div>
        <div class="mock-tile"></div>
        <div class="mock-tile"></div>
        <div class="mock-tile"></div>
      </div>
    </div>
  </div>
  <div class="tool-info">
    <div class="tool-title">Seletor de Prompts</div>
    <div class="tool-desc">Escolha um dos 6 estilos visuais, selecione a pessoa e gere uma imagem com IA — sem texto, só a foto processada.</div>
  </div>
</a>
```

**CSS to add** (inside the existing `<style>` block, after the last mockup block):

```css
/* ═══════════════════════════════════════════════════════════
   MOCKUP: Seletor de Prompts
   2x3 grid of small prompt tiles, first one highlighted
═══════════════════════════════════════════════════════════ */
.mock-seletor {
  display: flex; align-items: center; justify-content: center;
}
.mock-seletor-grid {
  display: grid; grid-template-columns: repeat(3, 54px);
  grid-template-rows: repeat(2, 54px); gap: 6px;
}
.mock-tile {
  border-radius: 6px;
  background: #161616;
  border: 1px solid #252525;
}
.mock-tile--active {
  border-color: rgba(65,193,194,.5);
  background: rgba(65,193,194,.08);
  box-shadow: 0 0 8px rgba(65,193,194,.2);
}
```

### 3.2 `server.js` — add route for new page (~3 LOC added)

Serve the new static file in the Express dev server. Find the block of `app.get('/<page>.html', ...)` routes and add:

```js
app.get('/seletor-prompts.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'seletor-prompts.html'));
});
```

Also ensure `/assets/prompt-previews/` is served. Check whether `express.static` already covers `assets/`; if not, add:

```js
app.use('/assets', express.static(path.join(__dirname, 'assets')));
```

### 3.3 `vercel.json` — add rewrite rule (~4 LOC added)

Follow the existing pattern for other `.html` pages. Add to the `"rewrites"` (or `"routes"`) array:

```json
{ "source": "/seletor-prompts.html", "destination": "/seletor-prompts.html" }
```

And ensure `/assets/prompt-previews/:file` is either served by the existing static file config or explicitly added. Vercel serves `public/` or project-root static files automatically for files not matched by a function route, so this should be zero-config if `assets/` lives at project root — verify against existing `vercel.json` structure.

---

## 4. File-by-File LOC Estimates

| File | Action | Est. LOC |
|---|---|---|
| `seletor-prompts.html` | Create | ~380 |
| `app.html` | Modify (card + CSS) | +~50 |
| `server.js` | Modify (route + static) | +~5 |
| `vercel.json` | Modify (rewrite entry) | +~3 |
| `assets/prompt-previews/` | Create directory + placeholder note | — |
| **Total new/modified lines** | | **~438** |

---

## 5. Acceptance Criteria

1. `/seletor-prompts.html` is accessible (PIN gate redirects unauthenticated users to `/`).
2. Typing a name in the search field shows Notion autocomplete results within ~500 ms; selecting a result loads the proxy photo silently (no UI error).
3. Exactly 6 prompt cards are visible in the grid; each card shows the preview image from `/assets/prompt-previews/prompt-N.jpg` and a label.
4. Clicking a prompt card selects it (teal border/highlight) and deselects all others — only one can be active at a time.
5. The Generate button is disabled until both a person (photo loaded) and a prompt are selected.
6. Clicking Generate triggers `POST /api/generate`; a spinner and status message appear.
7. Polling resolves and the result image is drawn onto `<canvas>` with no text overlay.
8. The Download button downloads the canvas as a `.jpg` or `.png`.
9. The hub page (`app.html`) shows a new "Seletor de Prompts" card linking to `/seletor-prompts.html`.
10. The 6 placeholder strings (`PROMPT_1_TEXT` … `PROMPT_6_TEXT`) are clearly visible in the source code at clearly labelled locations so the user can fill them in without hunting.
11. The page renders correctly on mobile (responsive grid collapses to a narrower layout).

---

## 6. Key Design Decisions

- **No new API endpoints.** The feature reuses `/api/generate`, `/api/generate/:taskId`, `/api/proxy-image`, and `/api/notion/search` exactly as-is.
- **Prompt texts are compile-time constants.** A `PROMPTS` array in the `<script>` block is the single source of truth; changing a prompt only requires editing that array.
- **Preview images are static files**, not generated at runtime. The user supplies them; the code just `<img src>` references them.
- **Canvas aspect ratio 1:1** (square) is the safe default for Freepik; can be changed in the `PROMPTS` array entry or as a global constant.
- **No canvas text overlay** — the generation result is drawn raw via `drawImage`, keeping the implementation simpler than `minibio.html`.
- **Inline styles + script** — consistent with every other page in the project; no build step, no imports.
