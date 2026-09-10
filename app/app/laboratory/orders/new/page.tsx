import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { OrderForm } from '@/components/orders/form';
import { OrderAccessDenied } from '@/components/orders/access';
export const metadata = {
  title: 'New laboratory order — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function NewOrderPage() {
  const user = await requireUser();
  if (!can(user.role, 'orders:create')) return <OrderAccessDenied />;
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/app/laboratory/orders" className="text-sm text-teal">
        ← Orders
      </Link>
      <h1 className="mb-2 mt-4 text-2xl font-semibold">New laboratory order</h1>
      <p className="mb-6 text-sm text-slate">
        Select a patient and active catalogue tests. The order number is
        assigned when the draft is saved.
      </p>
      <OrderForm />
    </div>
  );
}
