'use client';
export default function ResultsError({ reset }: { reset: () => void }) {
  return (
    <section
      role="alert"
      className="rounded-md border border-line bg-white p-6"
    >
      <h1 className="text-xl font-semibold">
        Laboratory results are unavailable
      </h1>
      <p className="mt-2 text-sm text-slate">
        Please try again. If this continues, contact your administrator.
      </p>
      <button
        className="mt-4 rounded bg-teal px-4 py-2 text-white"
        onClick={reset}
      >
        Try again
      </button>
    </section>
  );
}
