import { getDashboard } from '@/services/dashboard';
import { Dashboard } from '@/components/application/dashboard';
export default async function DashboardPage() {
  return <Dashboard {...await getDashboard()} />;
}
