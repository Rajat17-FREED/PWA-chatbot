import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import chatRouter from './routes/chat';
import evalsRouter from './routes/evals';
import { initCreditorData, initKnowledgeBase } from './routes/chat';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api', chatRouter);
app.use('/api/evals', evalsRouter);

// Serve eval dashboard (static HTML)
const evalsDashboardPath = path.join(__dirname, '..', 'public', 'evals');
app.use('/evals', express.static(evalsDashboardPath));

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

// Startup sequence — load datasets synchronously, then start serving immediately.
// RAG embedding store is built in the background (falls back to keyword selection until ready).
function main(): void {
  // Synchronous dataset loads (fast, in-memory CSV/JSON)
  initCreditorData();

  // Start server immediately — don't wait for embeddings
  app.listen(PORT, () => {
    console.log(`FREED Chatbot server running on http://localhost:${PORT}`);
  });

  // Build RAG embedding store in the background (PDF parse + OpenAI embed)
  // Chat endpoint already falls back to keyword selection if RAG isn't ready or times out
  initKnowledgeBase().catch(err => {
    console.error('[KB] Background knowledge base init failed:', err);
  });
}

main();
