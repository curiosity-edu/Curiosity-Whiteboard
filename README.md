This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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

- `data/solve_history.json`
```jsonc
{
  "sessions": [
    {
      "id": "1731520123456-abc12345",
      "title": "Quadratic Roots",            // Provided by model or follow-up naming call
      "createdAt": 1731520123456,
      "updatedAt": 1731520456789,
      "items": [
        { "question": "…transcribed text…", "response": "…AI response text…", "ts": 1731520123456 },
        { "question": "…", "response": "…", "ts": 1731520456789 }
      ]
    }
  ]
}
```
## Prompting Rules (No LaTeX)

- The system prompt and user prompt explicitly forbid LaTeX/TeX: no `\frac`, `\sec`, `\tan`, `$$`, `\[`, `\]`, or `\( \)`.
- Use natural text and inline math. Examples:
  - Use `x^2` or `sqrt(x)` rather than LaTeX.
  - Prefer `sec(x)`, `tan(x)`; Unicode like `×, ÷, √` when helpful.

## Program Flow (End-to-End)

1. User selects shapes or entire canvas and clicks “Ask AI”.
2. `Board.askAI()` exports a PNG of the selection, posts to `/api/solve` with `sessionId`.
3. `POST /api/solve` reads the current session, sends the image and context to OpenAI, parses JSON, and persists the new entry.
4. Client receives `{ message, questionText, sessionId }`.
5. UI:
   - Adds a notification card with the AI response in the right panel.
   - Creates a text shape with the AI response on the canvas near the selection.
6. History overlay:
   - Sessions list via `GET /api/history`.
   - Per-session messages via `GET /api/history?sessionId=...`.

## Public Interfaces (API Contracts)

- `POST /api/solve`
  - Request: `multipart/form-data` with fields:
    - `image`: PNG image (required)
    - `sessionId`: string (optional; if omitted, server generates one)
  - Response JSON:
    - `message: string` – natural text answer (no LaTeX)
    - `questionText: string` – model’s transcription of the input question
    - `sessionId: string` – active session ID that was used or created
    - `answerPlain`, `answerLatex`, `explanation` – optional legacy fields (kept for flexibility)

– `GET /api/history`
  - Response JSON: `{ sessions: Array<{ id, title, createdAt, updatedAt, count }> }`

– `GET /api/history?sessionId=...`
  - Response JSON: `{ items: Array<{ question, response, ts }>, title: string }`

## Styling & UX Notes

- Panel is the right quarter of the screen. Notifications are dismissible cards.
- History overlay is a full-height overlay over the panel. Message bubbles are styled like a chat: question right, answer left.
- Panel itself is read-only (no inputs apart from buttons).
- The canvas text created by answers uses `toRichText(finalText)` with a fixed width for readability.

## Development Tips

- Ensure only one version of `tldraw` libraries is bundled to avoid the “multiple instances” warning; if this appears in dev logs, check package resolution and lockfile(s).
- In serverless deployments, replace file persistence with durable storage.
- If a provider occasionally returns stray LaTeX, we can add an optional server-side sanitizer to strip TeX commands as a last resort.

## Future Enhancements (Next Action Items)

- The screenshot of the selection should only include the user's new question, not the entire canvas (previous questions can be derived from conversation history).
- Add a checkbox "Add to Canvas" in the AI Panel to allow the user to select whether they want the model response to appear in the canvas in addition to the AI Response tab. Only if it is selected, the answer positioning functionality will be used to add the AI response to the whiteboard as it currently does.