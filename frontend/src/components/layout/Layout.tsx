import { Outlet } from 'react-router-dom'
import { Footer } from './Footer'
import { TopNav } from './TopNav'

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <TopNav />
      <main className="min-w-0 flex-1 overflow-x-clip">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
