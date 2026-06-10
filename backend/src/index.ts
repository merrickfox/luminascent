import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { accordRoutes } from './features/accords/handlers';
import { brandRoutes } from './features/brands/handlers';
import { categoryRoutes } from './features/categories/handlers';
import { imageRoutes } from './features/images/handlers';
import { noteRoutes } from './features/notes/handlers';
import { productRoutes } from './features/products/handlers';
import { remindsRoutes } from './features/reminds/handlers';
import { reviewRoutes } from './features/reviews/handlers';
import { importRoutes } from './features/import/handlers';
import { voteRoutes } from './features/votes/handlers';
import { apiKeyAuth } from './lib/auth';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.get('/', (c) => c.json({ name: 'luminascent-backend', status: 'ok' }));

app.route('/brands', brandRoutes);
app.route('/categories', categoryRoutes);
app.route('/notes', noteRoutes);
app.route('/accords', accordRoutes);
app.route('/products', productRoutes);
app.route('/products', imageRoutes);
app.route('/products', voteRoutes);
app.route('/products', reviewRoutes);
app.route('/products', remindsRoutes);

const admin = new Hono<{ Bindings: Env }>();
admin.use('*', apiKeyAuth);
admin.route('/brands', brandRoutes);
admin.route('/categories', categoryRoutes);
admin.route('/notes', noteRoutes);
admin.route('/accords', accordRoutes);
admin.route('/products', productRoutes);
admin.route('/products', imageRoutes);
admin.route('/products', voteRoutes);
admin.route('/products', reviewRoutes);
admin.route('/products', remindsRoutes);
admin.route('/import', importRoutes);
app.route('/admin', admin);

export default app;
