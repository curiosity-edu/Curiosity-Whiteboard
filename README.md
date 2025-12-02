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

- File: `data/solve_history.json`
- Shape: Boards (no nested sessions). Each board is a single conversation timeline.

```jsonc
{
  "boards": [
    {
      "id": "1731520123456-abc12345",
      "title": "Algebra Practice", // Provided by user at creation time
      "createdAt": 1731520123456,
      "updatedAt": 1731520456789,
      "items": [
        {
          "question": "…transcribed text…",
          "response": "…AI response text…",
          "ts": 1731520123456
        },
        { "question": "…", "response": "…", "ts": 1731520456789 }
      ]
    }
  ]
}
```

- Migration: legacy `{"sessions": [...]}` is treated as `boards` for backward compatibility in the API.

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

- User lands at `GET /` → a new board is created via `POST /api/boards`, and the user is redirected to `/board/[id]` to see a blank whiteboard immediately.
- Top-right of the nav shows authentication controls:
  - Logged out: "Sign in with Google".
  - Logged in: "Hello [FirstName] • Sign out".
- The My Boards history now lives as a collapsible left sidebar on the board view.
- The `/boards` route exists only to redirect to the most recent board (or `/` if none). The header no longer shows a "My Boards" link.

### 1. Board View (`/board/[id]`)

- Renders `Board` with a required `boardId` prop.
- Left sidebar (signed-in users): `MyBoardsSidebar` lists boards from `GET /api/boards`, supports hover-delete (with confirmation), and navigation.
- Center: TLDraw canvas fills available height; bottom toolbar always visible.
- Right: AI Panel with controls (Ask AI, Add to Canvas, History). Collapsible and persisted in `localStorage`.

### 2. Ask AI (client in `src/components/Board.tsx`)

- Collects selected shapes (or all shapes if none) and exports as PNG (with padding, scale).
- Constructs `FormData` with `image` and `boardId`.
- `POST /api/solve` is called; loading state is shown.

### 2b. Voice Input Flow (client in `src/components/Board.tsx`)

- **Start/Stop**: The AI Panel has a `🎤 Speak / ⏹️ Stop` button.
- **Engine**: Uses the browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`). No external library.
- **Continuous listening**: `continuous = true` with an internal `keepListening` flag. On `onend`, if `keepListening` is true, recognition auto-restarts. User presses Stop to end.
- **Results handling**: Interim and final transcripts are accumulated. On session end/restart, the spoken text is:
  - Added to the canvas as a text note.
  - Passed to `askAI(spoken)` so the image export is paired with the spoken question.

### 3. Solve API (server in `src/app/api/solve/route.ts`)

- Validates the upload and reads current board items from `data/solve_history.json`.
- Sends the image and the board's prior items as JSON context to OpenAI with the system prompt.
  - Loads `mode_detection_rules.txt` and prepends it to the system prompt.
  - Appends the format policy + JSON keys section (unchanged) after the mode rules.
- Receives JSON `{ message, question_text, ... }`.
- Appends `{ question, response, ts }` to the specified board, updates `updatedAt`, and persists to file.
- Returns `{ message, questionText, boardId, ... }` to the client.

### 4. Authentication

- **Provider/Context**: `src/context/AuthContext.js` (Client Component) exposes `[user, googleSignIn, logOut]` using Firebase Auth.
- **UI Controls**: `src/components/AuthControls.tsx` (Client) renders in the header:
  - Logged out: "Sign in with Google".
  - Logged in: greeting + "Sign out".
- **Nav behavior**: `src/components/Nav.tsx` shows only static links (e.g., About). The My Boards entry has been removed (now a sidebar on the board).
- **Firebase config**: `src/lib/firebase.ts` initializes app/auth/storage/firestore. Analytics is guarded with `typeof window !== "undefined"` to avoid SSR errors.

### 5. Client Update (Board)

- Shows the AI response in the AI Panel list (newest first).
- If "Add to Canvas" is enabled, adds a TLDraw text shape below the selection with `toRichText(message)`.
- History overlay can be opened to view the entire board conversation; reads `GET /api/boards/[id]`.

### 6. Persistence

- File-based store `data/solve_history.json` is read/written on each request.
- In production, move to a real database (e.g., Firebase/Firestore) and associate boards to authenticated users.

### 7. Error Handling

- Network errors: Shows user-friendly error message in the AI panel
- API errors: Displays the error message from the server
- Invalid responses: Falls back to plain text display if JSON parsing fails
- Rate limiting: Implements exponential backoff for retries

## Styling & UX Notes

- **Header**: Sticky, solid white (`bg-white`), logo left, About link, and auth controls.
- **My Boards Sidebar**: Collapsible left sidebar, shown for signed-in users on the board page.
  - Toggle persists in `localStorage` under `boardsOpen`.
  - Hover over a board to reveal a trash icon. Clicking prompts a non-recoverable delete confirmation, then calls `DELETE /api/boards/[id]` and updates the UI.
- **Layout**: Full-height app with internal scrolling in side panels; canvas uses `absolute inset-0` inside a `min-h-0` flex layout.
- **AI Panel**: Collapsible right panel with Ask AI, Settings (Add to Canvas, History), and Voice controls.
  - Toggle persists in `localStorage` under `aiOpen`.
  - History overlay is an in-panel full overlay.
- **About page**: Full-width white background; content constrained to a readable column.

## Source Files Overview

- `src/app/layout.tsx` — Global layout (header with logo + `Nav`, sticky header, full-bleed underline, white background scaffolding).
- `src/app/page.tsx` — Creates a new board and redirects `/` to `/board/[id]`.
- `src/components/AuthControls.tsx` — Client auth UI in header (Sign in with Google / Hello [name] / Sign out).
- `src/context/AuthContext.js` — Client auth context exposing `[user, googleSignIn, logOut]`.
- `src/app/boards/page.tsx` — Redirects to the most recent board (or `/` if none). No separate My Boards UI.
- `src/components/MyBoardsSidebar.tsx` — Client sidebar listing boards, hover-delete with confirmation, navigation, and open-state persistence.
- `src/components/Nav.tsx` — Client nav (About link only); My Boards link removed.
- `src/app/board/[id]/page.tsx` — Server page that renders `<Board boardId={id} />`.
- `src/components/Nav.tsx` — Client nav with active highlighting for `/boards` and `/board/*`, plus link to `/about`.
- `src/components/Board.tsx` — Client TLDraw board + AI Panel. Sends `boardId` to `/api/solve`, shows responses, optional canvas insertion, and board History overlay.
- `src/app/api/boards/route.ts` — `GET` list boards; `POST` create board (migrates legacy `sessions` → `boards`).
- `src/app/api/boards/[id]/route.ts` — `GET` a single board (id, title, items). `DELETE` to remove a board.
- `src/app/api/solve/route.ts` — Accepts `image` + `boardId`, calls OpenAI, appends `{question,response,ts}` to the board, persists to file.
- `src/app/api/history/route.ts` — Legacy sessions endpoint (kept temporarily; UI no longer calls it).
- `src/app/globals.css` — Tailwind setup and theme tokens. Forces light background to avoid dark strips; sets body text color.
- `src/lib/firebase.ts` — Centralized Firebase initialization and exports (auth, storage, firestore, analytics guarded for SSR).
- `public/textblack.png` — Logo used in the header and About page.

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

- Fix voice input issues: should not add to whiteboard, should always be included in question transcription
- Create the ability to detect/highlight errors in user work (annotation)
- “Ask AI" responses should match the size of user text

### Deadline for Functionality Items: 12/14/2025

#### UI Related Tasks:

- AI Panel doesn't need to go all the way down (too much screen estate)
- Stack alerts like WhatsApp messages
- Write-out animation on whiteboard
- Ask AI should be bigger and more colorful

#### Deadline for UI Items: End of break

#### Deployment:

- Send email to Srividya (Cascadia)
- Send email to UW math professors

#### Second Sprint (Post Break):

- Integrate Legacy Curiosity features
  - Manim video generator (already implemented)
  - Course generator (partially implemented)
  - etc.
