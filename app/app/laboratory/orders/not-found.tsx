import Link from 'next/link';
export default function OrderNotFound() {
  return (
    <section>
      <h1 className="text-xl font-semibold">Order not found</h1>
      <p className="mt-2 text-sm text-slate">
        This laboratory order is unavailable in your organization.
      </p>
      <Link
        href="/app/laboratory/orders"
        className="mt-4 inline-block text-teal underline"
      >
        Back to orders
      </Link>
    </section>
  );
}
