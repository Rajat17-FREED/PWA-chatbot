import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import chatRouter from './routes/chat';
import { initCreditorData } from './routes/chat';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api', chatRouter);

// Serve static client build in production
const clientBuildPath = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientBuildPath));

// SPA fallback for client-side routing (Express 5 uses {*path} syntax)
app.get('{*path}', (_req, res) => {
  const indexPath = path.join(clientBuildPath, 'index.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Client build not found. Run npm run build in client/' });
  }
});

// Load creditor data at startup
initCreditorData();

app.listen(PORT, () => {
  console.log(`FREED Chatbot server running on http://localhost:${PORT}`);
});
