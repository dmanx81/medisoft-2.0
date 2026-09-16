import Link from 'next/link';
export default function DoctorNotFound() {
  return (
    <section>
      <h1 className="text-xl font-semibold">Doctor not found</h1>
      <p className="mt-2 text-sm text-slate">
        This profile is unavailable in your organization.
      </p>
      <Link href="/app/doctors" className="mt-4 inline-block text-teal underline">
        Back to doctors
      </Link>
    </section>
  );
}
