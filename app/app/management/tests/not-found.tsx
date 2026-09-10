import Link from 'next/link';
export default function TestNotFound() {
  return (
    <section>
      <h1 className="text-xl font-semibold">Test not found</h1>
      <p className="mt-2 text-sm text-slate">
        This catalogue entry is unavailable in your organization.
      </p>
      <Link
        href="/app/management/tests"
        className="mt-4 inline-block text-teal underline"
      >
        Back to tests
      </Link>
    </section>
  );
}
