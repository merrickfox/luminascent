import { Navigate, Route, Routes } from 'react-router-dom'
import { AppSidebar } from '@/components/app-sidebar'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AccordsPage } from '@/features/accords/accords-page'
import { BrandsPage } from '@/features/brands/brands-page'
import { CategoriesPage } from '@/features/categories/categories-page'
import { HomePage } from '@/features/home/home-page'
import { NotesPage } from '@/features/notes/notes-page'
import { ProductsPage } from '@/features/products/products-page'
import { ProductDetailPage } from '@/features/products/product-detail-page'
import { ImportPage } from '@/features/import/import-page'
import { ReviewsPage } from '@/features/reviews/reviews-page'
import { ScraperWorklistPage } from '@/features/scraper/scraper-worklist-page'
import { ScraperSitePage } from '@/features/scraper/scraper-site-page'
import { ScraperProductPage } from '@/features/scraper/scraper-product-page'

export default function App() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-14 items-center gap-2 border-b border-border px-4">
            <SidebarTrigger />
            <span className="text-sm text-muted-foreground">Luminascent Admin</span>
          </header>
          <main className="flex-1 p-6">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/products/:slug" element={<ProductDetailPage />} />
              <Route path="/brands" element={<BrandsPage />} />
              <Route path="/categories" element={<CategoriesPage />} />
              <Route path="/notes" element={<NotesPage />} />
              <Route path="/accords" element={<AccordsPage />} />
              <Route path="/reviews" element={<ReviewsPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/scraper" element={<ScraperWorklistPage />} />
              <Route path="/scraper/:folder" element={<ScraperSitePage />} />
              <Route path="/scraper/:folder/:slug" element={<ScraperProductPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
