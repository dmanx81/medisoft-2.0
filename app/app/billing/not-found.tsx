import Link from 'next/link';
export default function InvoiceNotFound() {
  return (
    <section>
      <h1 className="text-xl font-semibold">Invoice not found</h1>
      <p className="mt-2 text-sm text-slate">
        This invoice is unavailable in your organization.
      </p>
      <Link href="/app/billing" className="mt-4 inline-block text-teal underline">
        Back to billing
      </Link>
    </section>
  );
}
