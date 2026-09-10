'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, LogOut } from 'lucide-react';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
  SidebarFooter,
} from '@/components/ui/sidebar';
import { can, type Role } from '@/lib/auth/permissions';
import { navigation } from './navigation';
export function ApplicationShell({
  name,
  organizationName,
  userRole,
  children,
}: {
  name: string;
  organizationName: string;
  userRole: Role;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <SidebarProvider>
      <a
        href="#workspace"
        className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-white focus:p-3"
      >
        Skip to workspace
      </a>
      <Sidebar>
        <SidebarHeader className="border-b border-line p-5">
          <Link
            href="/app"
            className="flex items-center gap-2 text-xl font-semibold text-ink"
          >
            <Activity className="text-teal" aria-hidden="true" />
            MEDISOFT
          </Link>
          <p className="mt-2 truncate text-sm text-slate">{organizationName}</p>
        </SidebarHeader>
        <SidebarContent>
          {['Workspace', 'Laboratory', 'Practice', 'Management'].map(
            (group) => {
              const items = navigation.filter(
                (item) =>
                  item.group === group && can(userRole, item.permission),
              );
              return (
                items.length > 0 && (
                  <SidebarGroup key={group}>
                    <SidebarGroupLabel>{group}</SidebarGroupLabel>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {items.map((item) => (
                          <SidebarMenuItem key={item.href}>
                            <SidebarMenuButton
                              render={<Link href={item.href} />}
                              isActive={
                                pathname === item.href ||
                                (item.href !== '/app' &&
                                  !!pathname?.startsWith(`${item.href}/`))
                              }
                              aria-current={
                                pathname === item.href ||
                                (item.href !== '/app' &&
                                  !!pathname?.startsWith(`${item.href}/`))
                                  ? 'page'
                                  : undefined
                              }
                              className="h-9 rounded-md text-sm data-[active=true]:bg-mint data-[active=true]:text-teal"
                            >
                              {item.label}
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                )
              );
            },
          )}
        </SidebarContent>
        <SidebarFooter className="border-t border-line p-4">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-xs text-slate">{userRole.replaceAll('_', ' ')}</p>
          <form action="/api/auth/logout" method="post">
            <button
              className="mt-2 flex items-center gap-2 rounded border border-line px-3 py-2 text-sm"
              type="submit"
            >
              <LogOut size={15} aria-hidden="true" />
              Sign out
            </button>
          </form>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0 bg-[#f5f7f8]">
        <header className="flex h-16 items-center gap-3 border-b border-line bg-white px-5">
          <SidebarTrigger />
          <span className="text-sm text-slate">Workspace</span>
          <span aria-hidden="true" className="text-line">
            /
          </span>
          <span className="text-sm font-medium">
            {navigation.find(
              (item) =>
                pathname === item.href ||
                (item.href !== '/app' &&
                  !!pathname?.startsWith(`${item.href}/`)),
            )?.label ?? 'MEDISOFT'}
          </span>
        </header>
        <main id="workspace" className="w-full p-5 lg:p-8">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
