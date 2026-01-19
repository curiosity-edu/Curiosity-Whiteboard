This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Live Site

https://curiosity-edu.org

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Data Model

- Firestore (signed-in persistence):
  - `users/{uid}`
  - `users/{uid}/boards/{boardId}`

### User Document (`users/{uid}`)

```jsonc
{
  "uid": "...",
  "name": "...",
  "email": "...",
  "imageUrl": "...",
  "addToCanvas": false,
  "createdAt": "serverTimestamp()",
  "updatedAt": "serverTimestamp()"
}
```

### Board Document (`users/{uid}/boards/{boardId}`)

```jsonc
{
  "id": "1731520123456-abc12345",
  "title": "Algebra Practice",
  "createdAt": 1731520123456,
  "updatedAt": 1731520456789,
  "items": [
    {
      "question": "…transcribed text…",
      "response": "…AI response text…",
      "ts": 1731520123456
    }
  ],
  "doc": {
    /* TLDraw snapshot */
  }
}
```

Notes:

- `items` is a list of Q/A entries (one entry per “Ask AI”).
- `doc` is the TLDraw snapshot used to restore the canvas.
- For signed-out users, the app does not write to Firestore.

## Prompting Rules

### System Prompt

The system prompt is composed of two parts:

- The contents of `mode_detection_rules.txt` at the repository root (mode detection + response behavior).
- The existing format policy and JSON output instructions (unchanged), shown below for reference:

```
Response format policy: DO NOT use LaTeX/TeX markup or commands (no \frac, \sec, \tan, $$, \[, \], or \( \)).
Use natural language with inline math using plain text or Unicode symbols where helpful (e.g., ×, ÷, √, ⁰, ¹, ², ³, ⁴, ⁵, ⁶, ⁷, ⁸, ⁹), and function names like sec(x), tan(x).
When writing powers, use Unicode superscripts (e.g., x², x³) instead of caret notation. For fractions, use a slash (e.g., (a+b)/2) if needed. Keep the output readable as normal text.
Keep within ~120 words unless the image explicitly asks for detailed explanation.
You will be given prior conversation history as a JSON array of items {question, response}. Use it only as context; do not repeat it.
Return ONLY valid JSON with keys:
- message: <final response text>
- question_text: <your best transcription of the question from the image>
- mode_category: <the detected mode/category based on the user's intent>
- session_title (optional): If this seems to be the first message of a new session, provide a short 2-3 word descriptive title (no quotes, title case).
```

### User Prompt (image flow)

```
Here is the prior history as JSON. Use it as context: [historyString]
Now read the math in this image and respond using the rules above.
Important: write your response as natural text with inline math, not LaTeX/TeX. No backslashes or TeX commands.
Return ONLY JSON with the keys described above.
[Image: dataUrl]

### User Prompt (voice-only flow)

```

Here is the prior history as JSON. Use it as context: [historyString]
Now answer this question: [spoken text]
Important: write your response as natural text with inline math, not LaTeX/TeX. No backslashes or TeX commands.
Return ONLY JSON with the keys described above.

```

```

## Program Flow

### 0. Landing and Navigation

- User lands at `GET /`:
  - Signed-in:
    - Query `users/{uid}/boards` ordered by `updatedAt desc`.
    - Redirect to the most recently updated board.
    - If no boards exist, create an `Untitled Board` in Firestore and open it.
  - Signed-out:
    - Redirect to a fresh local board id (local-only).
- Navigation is minimal. The app surfaces an "About Us" link (icon-only in the collapsed sidebar; text + icon in the expanded sidebar).
- Authentication controls live in the left sidebar footer, not in a top header. In collapsed mode, a round avatar/sign‑in button appears at the bottom.
- The My Boards history lives as a collapsible left sidebar on the board view.
- The `/boards` route is not used as a dedicated boards page.

### 1. Board View (`/board/[id]`)

- Renders `Board` with a required `boardId` prop.
- Left sidebar (signed-in users): `MyBoardsSidebar` lists boards from Firestore (`users/{uid}/boards`), supports rename/delete, and navigation. Each board tile has a 3-dot menu (always visible, touch-friendly) that includes **Chat History**.
- Center: TLDraw canvas fills available height; TLDraw bottom toolbar is visible (top style panel is hidden by default).
- Top-right overlay: **Ask Curiosity** and **Voice/Cancel** controls (fixed position, do not move while panning). A floating stack of response bubbles appears under the Ask button (newest on top). Each bubble has `+` to add to canvas and `×` to dismiss; a global **Clear** button clears all. New bubbles animate in subtly and show the detected mode next to the timestamp when available.
- Signed-in board persistence:
  - On mount, TLDraw local persistence hydrates the canvas immediately for a smooth refresh.
  - Then we compare a local `localUpdatedAt` (stored per board in `localStorage`) to Firestore `updatedAt`; only if Firestore is newer do we apply the remote snapshot (`loadSnapshot`).
  - Autosave TLDraw snapshot (`doc`) to Firestore (debounced) using `updateDoc` so the entire `doc` field is replaced (not deep-merged).
  - Persist Q/A history (`items`) to Firestore.

### 2. Ask AI (client in `src/components/Board.tsx`)

- Collects selected shapes (or all shapes if none) and exports as PNG (with padding, scale).
- Constructs `FormData` with `image` (when shapes exist) and `boardId`.
- Includes `history` (stringified Q/A items) so the model has context.
- `POST /api/solve` is called; loading state is shown.
- The floating response stack is scrollable (max height) and auto-scrolls to the top whenever a new response arrives (newest-first ordering).

### 2b. Voice Input Flow (client in `src/components/Board.tsx`)

- **Start**: The top-right overlay has a **Voice** button (`🎤 Voice`) to start recording.
- **Cancel**: While recording, the **Cancel** button stops recording and discards the transcript (no request is sent).
- **Submit**: While recording, clicking **Ask Curiosity** stops recording and submits the spoken transcript.
- **Engine**: Uses the browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`). No external library.
- **Continuous listening**: `continuous = true` with an internal `keepListening` flag. On `onend`, if `keepListening` is true, recognition auto-restarts. User presses Stop to end.
- **Results handling**: Interim and final transcripts are accumulated. On session end/restart, the spoken text is:
  - Not added to the canvas.
  - Passed to `askAI(spoken)` so the existing canvas snapshot (if any) is paired with the question.
  - If the board has no shapes, a text-only request is sent (no image) and the server handles it.

### 3. Solve API (server in `src/app/api/solve/route.ts`)

- Accepts `image` (PNG) and/or `question` (text from voice). At least one must be present.
- Receives optional prior history from the client (as JSON string) for context.
- Voice-first behavior: when both image and voice are present, the voice question is treated as primary; if the vision output is empty/unhelpful, the server falls back to a text-only solve to ensure the spoken question is answered.
- Output sanitization: the server strips LaTeX/TeX from model responses to enforce the Response Format Policy before returning the final `message`.
- For image requests: sends the image + history to the model.
- For voice-only requests: sends the text question + history to the model (no image).
- Returns JSON `{ message, questionText, boardId, modeCategory, ... }`.

Note: persistence of Q/A history happens client-side (Firestore when signed in).

### 4. Authentication

- **Provider/Context**: `src/context/AuthContext.js` (Client Component) exposes `[user, googleSignIn, logOut]` using Firebase Auth.
- **UI Location**: Authentication controls are rendered in the left sidebar footer (not a top nav bar). In collapsed mode, a compact avatar/sign-in button appears at the bottom.
- **Navigation**: The app uses minimal navigation. An "About Us" link is available via the sidebar (icon-only when collapsed; icon + text when expanded).
- **Firebase config**: `src/lib/firebase.ts` initializes app/auth/storage/firestore. Analytics is guarded with `typeof window !== "undefined"` to avoid SSR errors.

### 5. Client Update (Board)

- Shows AI responses as floating bubbles in the top-right stack (newest first). Each bubble can be added to canvas (`+`) or dismissed (`×`). A **Clear** control clears all bubbles. The stack auto-scrolls back to the top on each new response while still allowing manual scroll to older messages. New bubbles animate in and display the detected mode next to the timestamp when available.
- If "Add to Canvas" is enabled, adds a TLDraw text shape below the selection with `toRichText(message)`.
- History overlay can be opened to view the entire board conversation; reads `GET /api/boards/[id]`.

### 6. Persistence

- Signed-in:
  - Firestore user document: `users/{uid}`
  - Firestore boards: `users/{uid}/boards/{boardId}`
  - TLDraw local persistence is enabled as a fast local cache (instant paint on refresh). Firestore remains authoritative via a freshness check: only apply Firestore if its `updatedAt` is newer than the local `localUpdatedAt`.
- Signed-out:
  - No Firestore writes.
  - TLDraw uses client persistence for the anonymous session.

#### Deletion persistence and merge semantics

- Snapshot autosave uses `updateDoc(ref, { doc: snapshot, updatedAt })`.
- This replaces the entire `doc` field (no deep merge), ensuring deleted shapes are actually removed from Firestore. Using `setDoc(..., { merge: true })` can leave nested keys behind and is avoided for updates. A `setDoc` fallback is used only to create a new board document if it does not yet exist.

### 8. UI Notes (Overlays and TLDraw UI)

- The old right AI panel has been removed in favor of **overlay controls**.
- The **top-right** overlay contains Ask Curiosity, Voice, Cancel (while recording), and Clear; responses appear as a vertical stack beneath (newest at top).
- **Chat History** is accessible from each board tile’s 3-dot menu and opens a **right-side collapsible sidebar**.
- The TLDraw **top style panel** is hidden by default to keep the canvas clean (only the bottom toolbar remains visible).

### 7. Error Handling

- Network errors: Shows user-friendly error message in the AI panel
- API errors: Displays the error message from the server
- Invalid responses: Falls back to plain text display if JSON parsing fails
- Rate limiting: Implements exponential backoff for retries

## Styling & UX Notes

- **Global layout**: The root layout pins the app to the viewport (fixed `main` covering the screen). Scrolling happens inside panels.
- **My Boards Sidebar**: Collapsible left sidebar (persists in `localStorage` under `boardsOpen`).
  - Collapse/expand uses `TbLayoutSidebarLeftCollapseFilled`.
  - Each board tile includes an always-visible 3-dot menu with Chat History, Rename, and Delete (touch-friendly).
  - "Generative Manim" uses `MdAnimation`.
  - "About Us" uses `FcAbout`.
  - "New Board" uses `IoIosCreate`.
  - Hover over a board to reveal delete; confirmation precedes `DELETE /api/boards/[id]`.
- **Canvas/Layout**: TLDraw canvas fills available space via `absolute inset-0` within a `min-h-0` flex container.
- **AI Overlay**: Top-right overlay hosts Ask Curiosity + Voice (or Cancel while recording) + Clear. Responses render as a stacked, scrollable bubble list (newest first) that auto-scrolls to the top on new messages; new bubbles animate in and show the detected mode when available. Chat History opens from the board tile menu as a right-side collapsible sidebar. The "Add to Canvas" preference is stored in `localStorage`.
- **About page**: Scrollable within the fixed layout by using a viewport-height container (`h-screen`) with `overflow-y: auto`; content is a centered readable column.

## Generative Manim (WIP)

- Route: `GET /manim`
- UI: Header + prompt input + no-op Generate button (placeholder for future work).

## Source Files Overview

- `src/app/layout.tsx` — Global layout with a fixed main viewport and white background scaffolding; content panes scroll internally.
- `src/app/page.tsx` — Signed-in redirect to most recent Firestore board (or auto-create `Untitled Board`), signed-out redirects to a fresh local board.
- `src/context/AuthContext.js` — Client auth context exposing `[user, googleSignIn, logOut]`.
- `src/components/AuthControls.tsx` — Sign-in/sign-out controls (routes to `/` after auth changes).
- `src/app/boards/new/page.tsx` — Creates a new Firestore board (signed-in) and navigates to `/board/[id]`.
- `src/app/boards/page.tsx` — Not a boards index page (currently `notFound()`).
- `src/components/MyBoardsSidebar.tsx` — Client sidebar listing boards, hover-delete with confirmation, navigation, and open-state persistence.
- `src/app/board/[id]/page.tsx` — Server page that renders `<Board boardId={id} />`.
- `src/components/Board.tsx` — Client TLDraw board + AI Panel. Calls `/api/solve`, shows responses, and persists board state/history to Firestore when signed in.
- `src/app/api/solve/route.ts` — Accepts `image` (+ optional `history`) and calls OpenAI. Stateless (no server-side persistence).
- `src/app/manim/page.tsx` — Placeholder Generative Manim page (prompt input + Generate telling button).
- `src/app/api/boards/*` — Legacy JSON-based board endpoints (no longer used for signed-in persistence).
- `src/app/api/history/route.ts` — Legacy sessions endpoint.
- `src/app/globals.css` — Tailwind setup and theme tokens. Forces light background to avoid dark strips; sets body text color.
- `src/lib/firebase.ts` — Centralized Firebase initialization and exports (auth, storage, firestore, analytics guarded for SSR).
- `public/textred.png` — Logo used in the left sidebar and About page.
- `public/Asset 7.svg` — Sidebar icon used for the collapsed sidebar button.
