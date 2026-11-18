import 'dotenv/config';
import express from 'express';
import path from 'path';
import { ensureDataDirectories } from './src/storage/dataStore.ts';
import { messageRouter } from './src/routes/messageRoutes.ts';
import { planRouter } from './src/routes/planRoutes.ts';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

ensureDataDirectories();

app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: 'text/*', limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'PlanGUARD',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/messages', messageRouter);
app.use('/api', planRouter);

const publicDir = path.resolve(process.cwd(), 'public');
app.use(express.static(publicDir));

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PlanGUARD server running at http://0.0.0.0:${PORT}`);
});
