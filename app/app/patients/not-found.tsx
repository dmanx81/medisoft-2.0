import Link from 'next/link';
export default function PatientNotFound() {
  return (
    <section>
      <h1 className="text-xl font-semibold">Patient not found</h1>
      <p className="mt-2 text-sm text-slate">
        This record is unavailable in your organization.
      </p>
      <Link
        href="/app/patients"
        className="mt-4 inline-block text-teal underline"
      >
        Back to patients
      </Link>
    </section>
  );
}
