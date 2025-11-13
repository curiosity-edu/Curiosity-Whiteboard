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
## Prompting Rules

The system uses the following exact prompt when communicating with the AI model:

```
You are a careful math solver that reads problems from images.
You must decide the response style from the problem itself:
- If the image explicitly asks for an explanation (e.g., 'explain', 'why', 'show steps/work', 'derive', 'prove', 'justify'),
  provide a natural, concise explanation: start with the result, then 2–4 short sentences that explain how.
- Otherwise, return a work-only solution: a sequence of line-by-line algebraic transformations with minimal labels (<= 6 words).
  No paragraphs, no extra commentary. Finish with the final answer on the last line.

Response format policy:
- DO NOT use LaTeX/TeX markup or commands (no \\frac, \\sec, \\tan, $$, \[, \], or \( \))
- Use natural language with inline math using plain text or Unicode symbols where helpful (e.g., ×, ÷, √, ⁰, ¹, ², ³, ⁴, ⁵, ⁶, ⁷, ⁸, ⁹)
- Use function names like sec(x), tan(x)
- For fractions, use a slash (e.g., (a+b)/2) if needed
- Keep the output readable as normal text
- Keep within ~120 words unless the image explicitly asks for detailed explanation
- Use prior conversation history (provided as JSON) only as context; do not repeat it

## Program Flow

### 1. User Interaction
- User selects shapes or the entire canvas on the whiteboard
- User clicks the "Ask AI" button in the toolbar
- The selection is captured as a PNG image

### 2. Client-Side Processing (`Board.askAI()` in `Board.tsx`)
- Exports the selected area as a PNG image
- If no shapes are selected, captures the entire canvas
- Retrieves or generates a `sessionId` (stored in localStorage)
- Shows a loading state in the AI panel
- Makes a POST request to `/api/solve` with:
  - `image`: The PNG image data
  - `sessionId`: Current session identifier

### 3. Server-Side Processing (`/api/solve` endpoint)
- Validates the request and authentication
- Reads the existing session history from `data/solve_history.json`
- If `sessionId` is new, creates a new session entry
- Sends the image and conversation history to OpenAI's API with specific formatting instructions
- Uses GPT-4 with vision capabilities
- Includes system prompt for response formatting
- Provides conversation history as context
- Requests JSON response with specific structure

### 4. AI Processing (OpenAI API)
- Analyzes the image using vision capabilities
- Processes any text in the image
- Generates a response following the format guidelines:
  - Uses Unicode for mathematical notation (e.g., x², √3, ¼)
  - Structures response based on whether explanation is requested
  - Returns a JSON object with `message` and `question_text`

### 5. Response Handling
- Server receives and validates the AI response
- Updates the session history with the new Q&A pair
- Persists the updated history to `data/solve_history.json`
- Returns JSON response to the client:
  ```json
  {
    "message": "AI response text with formatted math",
    "questionText": "Extracted question from the image",
    "sessionId": "current-session-id",
    "sessionTitle": "Optional session title"
  }
  ```

### 6. Client-Side Update
- Updates the AI panel with the response:
  - Adds a new notification card with the response
  - Formats the response with proper math notation
  - Updates the session title if this is the first message
- Creates a text shape on the canvas:
  - Positions it near the original selection
  - Applies appropriate styling for AI responses
  - Makes it selectable and movable
- Updates the history panel with the new interaction

### 7. History Management
- Sessions list view (`GET /api/history`):
  - Returns metadata for all sessions
  - Includes title, timestamp, and preview of last message
- Session details (`GET /api/history?sessionId=...`):
  - Returns full conversation history for a specific session
  - Includes all Q&A pairs with timestamps
- Persistence:
  - All data stored in `data/solve_history.json`
  - File is read/written on each request (simple file-based storage)
  - For production, consider using a database

### 8. Error Handling
- Network errors: Shows user-friendly error message in the AI panel
- API errors: Displays the error message from the server
- Invalid responses: Falls back to plain text display if JSON parsing fails
- Rate limiting: Implements exponential backoff for retries

## Styling & UX Notes

- Panel is the right quarter of the screen. Notifications are dismissible cards.
- History overlay is a full-height overlay over the panel. Message bubbles are styled like a chat: question right, answer left.
- The canvas text created by answers uses `toRichText(finalText)` with a fixed width for readability.

## Development Tips

- Ensure only one version of `tldraw` libraries is bundled to avoid the “multiple instances” warning; if this appears in dev logs, check package resolution and lockfile(s).
- In serverless deployments, replace file persistence with durable storage.
- If a provider occasionally returns stray LaTeX, we can add an optional server-side sanitizer to strip TeX commands as a last resort.

## Future Enhancements (Next Action Items)

- The screenshot of the selection should only include the user's new question, not the entire canvas (previous questions can be derived from conversation history).
- Add a checkbox "Add to Canvas" in the AI Panel to allow the user to select whether they want the model response to appear in the canvas in addition to the AI Response tab. Only if it is selected, the answer positioning functionality will be used to add the AI response to the whiteboard as it currently does.