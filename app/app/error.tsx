'use client';
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <section
      role="alert"
      className="rounded-md border border-line bg-white p-6"
    >
      <h1 className="text-xl font-semibold">
        Workspace temporarily unavailable
      </h1>
      <p className="mt-2 text-slate">
        Please try again. If this continues, contact your administrator.
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded bg-teal px-4 py-2 text-white"
      >
        Try again
      </button>
    </section>
  );
}
