import { Link, useLocation } from 'react-router-dom'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { EnvSelect } from '@/components/env-select'
import { useEnv } from '@/context/env-context'
import {
  Building2,
  CandlestickChart,
  DatabaseZap,
  FolderTree,
  Layers,
  MessageSquareText,
  Music2,
  Radar,
} from 'lucide-react'

const catalogItems = [
  { title: 'Products', href: '/products', icon: CandlestickChart },
]

const operationsItems = [
  { title: 'Scraper', href: '/scraper', icon: Radar },
  { title: 'User reviews', href: '/reviews', icon: MessageSquareText },
  { title: 'Import', href: '/import', icon: DatabaseZap },
]

const referenceItems = [
  { title: 'Brands', href: '/brands', icon: Building2 },
  { title: 'Categories', href: '/categories', icon: FolderTree },
  { title: 'Notes', href: '/notes', icon: Music2 },
  { title: 'Accords', href: '/accords', icon: Layers },
]

export function AppSidebar() {
  const location = useLocation()
  const { environment } = useEnv()

  return (
    <Sidebar>
      <SidebarHeader className="gap-3 border-b border-sidebar-border p-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold">Luminascent</p>
          <p className="text-xs text-muted-foreground">Admin Panel</p>
        </div>
        <EnvSelect />
        <p className="truncate text-xs text-muted-foreground">{environment.host}</p>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Catalog</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {catalogItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link to={item.href} />}
                    isActive={location.pathname.startsWith(item.href)}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {operationsItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link to={item.href} />}
                    isActive={location.pathname.startsWith(item.href)}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Reference</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {referenceItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link to={item.href} />}
                    isActive={location.pathname.startsWith(item.href)}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
