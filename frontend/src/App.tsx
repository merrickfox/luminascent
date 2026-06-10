import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { AboutPage } from './pages/AboutPage'
import { BrandPage } from './pages/BrandPage'
import { BrandsPage } from './pages/BrandsPage'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProductPage } from './pages/ProductPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="brands" element={<BrandsPage />} />
        <Route path="brands/:slug" element={<BrandPage />} />
        <Route path="products/:slug" element={<ProductPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
