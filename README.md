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
- session_title (optional): If this seems to be the first message of a new session, provide a short 2-3 word descriptive title (no quotes, title case).
```

### User Prompt

```
Here is the prior history as JSON. Use it as context: [historyString]
Now read the math in this image and respond using the rules above.
Important: write your response as natural text with inline math, not LaTeX/TeX. No backslashes or TeX commands.
Return ONLY JSON with the keys described above.
[Image: dataUrl]
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
- Left sidebar (signed-in users): `MyBoardsSidebar` lists boards from Firestore (`users/{uid}/boards`), supports rename/delete, and navigation.
- Center: TLDraw canvas fills available height; bottom toolbar always visible.
- Right: AI Panel with controls (Ask AI, Add to Canvas, History). Collapsible and persisted in `localStorage`.
- Signed-in board persistence:
  - On mount, load `doc` and `items` from Firestore.
  - Autosave TLDraw snapshot (`doc`) to Firestore (debounced).
  - Persist Q/A history (`items`) to Firestore.

### 2. Ask AI (client in `src/components/Board.tsx`)

- Collects selected shapes (or all shapes if none) and exports as PNG (with padding, scale).
- Constructs `FormData` with `image` and `boardId`.
- Includes `history` (stringified Q/A items) so the model has context.
- `POST /api/solve` is called; loading state is shown.

### 2b. Voice Input Flow (client in `src/components/Board.tsx`)

- **Start/Stop**: The AI Panel has a `🎤 Speak / ⏹️ Stop` button.
- **Engine**: Uses the browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`). No external library.
- **Continuous listening**: `continuous = true` with an internal `keepListening` flag. On `onend`, if `keepListening` is true, recognition auto-restarts. User presses Stop to end.
- **Results handling**: Interim and final transcripts are accumulated. On session end/restart, the spoken text is:
  - Added to the canvas as a text note.
  - Passed to `askAI(spoken)` so the image export is paired with the spoken question.

### 3. Solve API (server in `src/app/api/solve/route.ts`)

- Validates the upload.
- Receives optional prior history from the client (as JSON string) for context.
- Sends the image and provided history to OpenAI with the format policy.
- Receives JSON `{ message, question_text, ... }`.
- Returns `{ message, questionText, boardId, ... }` to the client.

Note: persistence of Q/A history happens client-side (Firestore when signed in).

### 4. Authentication

- **Provider/Context**: `src/context/AuthContext.js` (Client Component) exposes `[user, googleSignIn, logOut]` using Firebase Auth.
- **UI Location**: Authentication controls are rendered in the left sidebar footer (not a top nav bar). In collapsed mode, a compact avatar/sign-in button appears at the bottom.
- **Navigation**: The app uses minimal navigation. An "About Us" link is available via the sidebar (icon-only when collapsed; icon + text when expanded).
- **Firebase config**: `src/lib/firebase.ts` initializes app/auth/storage/firestore. Analytics is guarded with `typeof window !== "undefined"` to avoid SSR errors.

### 5. Client Update (Board)

- Shows the AI response in the AI Panel list (newest first).
- If "Add to Canvas" is enabled, adds a TLDraw text shape below the selection with `toRichText(message)`.
- History overlay can be opened to view the entire board conversation; reads `GET /api/boards/[id]`.

### 6. Persistence

- Signed-in persistence:
  - Firestore user document: `users/{uid}`
  - Firestore boards: `users/{uid}/boards/{boardId}`
- Signed-out:
  - No Firestore writes.
  - TLDraw uses client persistence for the anonymous session.

### 7. Error Handling

- Network errors: Shows user-friendly error message in the AI panel
- API errors: Displays the error message from the server
- Invalid responses: Falls back to plain text display if JSON parsing fails
- Rate limiting: Implements exponential backoff for retries

## Styling & UX Notes

- **Global layout**: The root layout pins the app to the viewport (fixed `main` covering the screen). Scrolling happens inside panels.
- **My Boards Sidebar**: Collapsible left sidebar (persists in `localStorage` under `boardsOpen`).
  - Collapse/expand uses `TbLayoutSidebarLeftCollapseFilled`.
  - "About Us" uses `FcAbout`.
  - "New Board" uses `IoIosCreate`.
  - Hover over a board to reveal delete; confirmation precedes `DELETE /api/boards/[id]`.
- **Canvas/Layout**: TLDraw canvas fills available space via `absolute inset-0` within a `min-h-0` flex container.
- **AI Panel**: Collapsible right panel with Ask AI, Settings (Add to Canvas, History), and Voice controls.
  - Collapse uses `TbLayoutSidebarRightCollapseFilled`.
  - Settings button uses `IoIosSettings`.
  - Toggle persists in `localStorage` under `aiOpen`. History is an in-panel overlay.
- **About page**: Scrollable within the fixed layout by using a viewport-height container (`h-screen`) with `overflow-y: auto`; content is a centered readable column.

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
- `src/app/api/boards/*` — Legacy JSON-based board endpoints (no longer used for signed-in persistence).
- `src/app/api/history/route.ts` — Legacy sessions endpoint.
- `src/app/globals.css` — Tailwind setup and theme tokens. Forces light background to avoid dark strips; sets body text color.
- `src/lib/firebase.ts` — Centralized Firebase initialization and exports (auth, storage, firestore, analytics guarded for SSR).
- `public/textred.png` — Logo used in the left sidebar and About page.
- `public/Asset 7.svg` — Sidebar icon used for the collapsed sidebar button.

## Development Tips

- Ensure only one version of `tldraw` libraries is bundled to avoid the “multiple instances” warning; if this appears in dev logs, check package resolution and lockfile(s).
- In serverless deployments, replace file persistence with durable storage.
- If a provider occasionally returns stray LaTeX, we can add an optional server-side sanitizer to strip TeX commands as a last resort.

## Action Items

### Meeting Recaps: [Curiosity Diaries](https://drive.google.com/drive/folders/17Z9vFGqZ38VGecYGry0HLb0c6AFYhKCR?usp=sharing)

### Next Task

- Add event handlers that call Firebase functions that write to the Firestore
- Ensure that Google SSO accurately writes to the Users collection and Board creation writes to the Boards collection

### Other Functionality Tasks

- Currently, changes to board state are saved when the user is signed in even after closing the tab. However, when the user signs out and signs in again, the whiteboard reverts to an empty state and loses all progress. This needs to be fixed.
- Give the "Ask AI" feature the ability to detect/highlight errors in user work (ie. add annotations).
- When added to canvas, “Ask AI" responses should match the size of user text

### Deadline for Functionality Items: 12/15/2025

#### Winter Break:

- Buffer to complete unfinished functionality items
- Polish up UI/UX based on feedback
- Comprehensively understand codebase
- Prepare for deployment
- Test all features thoroughly


#### Second Sprint (Post Break):

- Integrate Legacy Curiosity features
  - Manim video generator (already implemented, needs to be piped in to current codebase)
  - Course generator (partially implemented)
  - Whiteboard 2.0 where the LLM has live access to the user's canvas updates and can provide real-time feedback
