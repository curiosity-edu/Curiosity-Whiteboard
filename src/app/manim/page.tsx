import Link from "next/link";

export default function ManimPage() {
  return (
    <div className="bg-white h-screen w-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 text-neutral-900 bg-white">
        <div className="mb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 border border-neutral-300 rounded-md hover:bg-neutral-200"
            aria-label="Go back to whiteboard"
          >
            <span>←</span>
            <span>Go back to whiteboard</span>
          </Link>
        </div>

        <h1 className="text-2xl font-semibold mb-4">Generative Manim</h1>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            placeholder="Type a prompt to generate a relevant math animation."
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
          />
          <button
            type="button"
            className="rounded-md bg-neutral-900 text-white px-4 py-2 text-sm font-medium hover:bg-neutral-800"
          >
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}
