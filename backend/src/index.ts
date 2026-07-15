import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { PrismaClient } from '@prisma/client';

import authRoutes from './routes/auth';
import organizationsRoutes from './routes/organizations';
import usersRoutes from './routes/users';
import dashboardRoutes from './routes/dashboard';
import analyticsRoutes from './routes/analytics';
import billingRoutes from './routes/billing';
import notificationsRoutes from './routes/notifications';
import auditRoutes from './routes/audit';
import webhooksRoutes from './routes/webhooks';

import { authMiddleware } from './middleware/auth';
import { rateLimiter } from './middleware/rateLimit';
import { startNotificationJob } from './jobs/notifications';
import { startReportJob } from './jobs/reports';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

export const prisma = new PrismaClient();
app.use(cors({
  origin: '*', // This is a security issue, but it's out of scope for now.
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());
app.use(rateLimiter);

// Health check - this is fine, no auth needed
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public routes
app.use('/api/auth', authRoutes);

// Protected routes
app.use('/api/organizations', authMiddleware, organizationsRoutes);
app.use('/api/users', authMiddleware, usersRoutes);
app.use('/api/dashboards', authMiddleware, dashboardRoutes);
app.use('/api/analytics', authMiddleware, analyticsRoutes);
app.use('/api/billing', authMiddleware, billingRoutes);
app.use('/api/notifications', authMiddleware, notificationsRoutes);
app.use('/api/audit', authMiddleware, auditRoutes);
app.use('/api/webhooks', authMiddleware, webhooksRoutes);

// WebSocket handling
const wsClients = new Map<string, Set<any>>();

wss.on('connection', (ws, req) => {
  const orgId = req.url?.split('?org=')[1];

  if (orgId) {
    if (!wsClients.has(orgId)) {
      wsClients.set(orgId, new Set());
    }
    wsClients.get(orgId)!.add(ws);

    ws.on('close', () => {
      wsClients.get(orgId)?.delete(ws);
    });
  }

  ws.on('message', (data) => {
    // Broadcast to all clients in same org
    const message = JSON.parse(data.toString());
    if (message.orgId && wsClients.has(message.orgId)) {
      wsClients.get(message.orgId)?.forEach(client => {
        if (client !== ws && client.readyState === 1) {
          client.send(JSON.stringify(message));
        }
      });
    }
  });
});

// Broadcast helper for routes to use
export function broadcastToOrg(orgId: string, message: object) {
  if (wsClients.has(orgId)) {
    wsClients.get(orgId)?.forEach(client => {
      if (client.readyState === 1) {
        client.send(JSON.stringify(message));
      }
    });
  }
}

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    stack: err.stack
  });
});

// Start background jobs
startNotificationJob();
startReportJob();

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
