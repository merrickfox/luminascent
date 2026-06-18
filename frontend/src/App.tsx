import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { AboutPage } from './pages/AboutPage'
import { BrandPage } from './pages/BrandPage'
import { BrandsPage } from './pages/BrandsPage'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProductPage } from './pages/ProductPage'
import { ProductPageV2 } from './pages/ProductPageV2'
import { ProfilePage } from './pages/ProfilePage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="brands" element={<BrandsPage />} />
        <Route path="brands/:slug" element={<BrandPage />} />
        <Route path="products/:slug" element={<ProductPageV2 />} />
        <Route path="products/:slug/v1" element={<ProductPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
