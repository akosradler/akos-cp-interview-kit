import { Router, Response, Request } from 'express';
import { prisma } from '../index';
import { AuthRequest, requireOwnerOrAdmin } from '../middleware/auth';
import { generateToken, verifyWebhookSignature } from '../utils/encryption';
import { v4 as uuidv4 } from 'uuid';
import https from 'https';
import http from 'http';

const router = Router();

// Get all webhooks
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(webhooks);
  } catch (error) {
    console.error('Get webhooks error:', error);
    res.status(500).json({ error: 'Failed to get webhooks' });
  }
});

// Get single webhook
router.get('/:webhookId', async (req: AuthRequest, res: Response) => {
  try {
    const { webhookId } = req.params;
    const webhook = await prisma.webhook.findFirst({
      where: {
        id: webhookId,
        organizationId: req.user!.organizationId
      }
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    res.json(webhook);
  } catch (error) {
    console.error('Get webhook error:', error);
    res.status(500).json({ error: 'Failed to get webhook' });
  }
});

// Create webhook
router.post('/', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, url, events } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: 'Name and URL required' });
    }
    // Could be used to probe internal network

    const secret = generateToken(32);

    const webhook = await prisma.webhook.create({
      data: {
        id: uuidv4(),
        name,
        url,
        secret,
        events: events || ['*'],
        organizationId: req.user!.organizationId
      }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        id: uuidv4(),
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        action: 'webhook.created',
        resourceType: 'webhook',
        resourceId: webhook.id,
        details: { name, url, events }
      }
    });

    res.status(201).json(webhook);
  } catch (error) {
    console.error('Create webhook error:', error);
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

// Update webhook
router.put('/:webhookId', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { webhookId } = req.params;
    const { name, url, events, isActive } = req.body;
    const existing = await prisma.webhook.findFirst({
      where: {
        id: webhookId,
        organizationId: req.user!.organizationId
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (url !== undefined) updateData.url = url;
    if (events !== undefined) updateData.events = events;
    if (isActive !== undefined) updateData.isActive = isActive;

    const webhook = await prisma.webhook.update({
      where: { id: webhookId },
      data: updateData
    });

    res.json(webhook);
  } catch (error) {
    console.error('Update webhook error:', error);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

// Delete webhook
router.delete('/:webhookId', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { webhookId } = req.params;
    const { count } = await prisma.webhook.deleteMany({
      where: {
        id: webhookId,
        organizationId: req.user!.organizationId
      }
    });

    if (count === 0) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    res.json({ message: 'Webhook deleted' });
  } catch (error) {
    console.error('Delete webhook error:', error);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

// Regenerate webhook secret
router.post('/:webhookId/regenerate-secret', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { webhookId } = req.params;

    const existing = await prisma.webhook.findFirst({
      where: {
        id: webhookId,
        organizationId: req.user!.organizationId
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const newSecret = generateToken(32);
    await prisma.webhook.update({
      where: { id: webhookId },
      data: { secret: newSecret }
    });

    res.json({ secret: newSecret });
  } catch (error) {
    console.error('Regenerate secret error:', error);
    res.status(500).json({ error: 'Failed to regenerate secret' });
  }
});

// Test webhook
router.post('/:webhookId/test', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { webhookId } = req.params;

    const webhook = await prisma.webhook.findFirst({
      where: {
        id: webhookId,
        organizationId: req.user!.organizationId
      }
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    // Send test payload
    const payload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      data: {
        message: 'This is a test webhook delivery'
      }
    };

    const result = await deliverWebhook(webhook, payload);

    // Update last triggered
    await prisma.webhook.update({
      where: { id: webhookId },
      data: { lastTriggeredAt: new Date() }
    });

    res.json(result);
  } catch (error) {
    console.error('Test webhook error:', error);
    res.status(500).json({ error: 'Failed to test webhook' });
  }
});

// Get webhook deliveries (would need a separate table in real app)
router.get('/:webhookId/deliveries', async (req: AuthRequest, res: Response) => {
  try {
    res.json([]);
  } catch (error) {
    console.error('Get deliveries error:', error);
    res.status(500).json({ error: 'Failed to get deliveries' });
  }
});

// Internal function to deliver webhooks
async function deliverWebhook(webhook: any, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const payloadString = JSON.stringify(payload);

    // Generate signature
    const crypto = require('crypto');
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(payloadString)
      .digest('hex');

    const url = new URL(webhook.url);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    const req = client.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payloadString),
        'X-Webhook-Signature': signature,
        'X-Webhook-ID': webhook.id,
        'User-Agent': 'InsightHub-Webhook/1.0'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          success: res.statusCode && res.statusCode < 400,
          statusCode: res.statusCode,
          response: data.substring(0, 500) // Limit response size
        });
      });
    });

    req.on('error', (error) => {
      prisma.webhook.update({
        where: { id: webhook.id },
        data: { failureCount: { increment: 1 } }
      }).catch(console.error);

      resolve({
        success: false,
        error: error.message
      });
    });

    req.write(payloadString);
    req.end();
  });
}

// Trigger webhook for event (called by other parts of the system)
export async function triggerWebhooks(orgId: string, event: string, data: any) {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
        OR: [
          { events: { has: '*' } },
          { events: { has: event } }
        ]
      }
    });

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data
    };
    for (const webhook of webhooks) {
      // Fire and forget - no await
      deliverWebhook(webhook, payload).then(result => {
        if (!result.success) {
          console.log(`Webhook delivery failed for ${webhook.id}:`, result.error);
        }
      });
    }
  } catch (error) {
    console.error('Trigger webhooks error:', error);
  }
}

// Incoming webhook handler (for receiving data from external services)
router.post('/incoming/:webhookId', async (req: Request, res: Response) => {
  try {
    const { webhookId } = req.params;
    const signature = req.headers['x-webhook-signature'] as string;

    const webhook = await prisma.webhook.findUnique({
      where: { id: webhookId }
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    if (signature) {
      const isValid = verifyWebhookSignature(
        JSON.stringify(req.body),
        signature,
        webhook.secret
      );

      if (!isValid) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    // Process incoming webhook
    console.log(`Received webhook ${webhookId}:`, req.body);

    // Would process data here

    res.json({ received: true });
  } catch (error) {
    console.error('Incoming webhook error:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

export default router;
