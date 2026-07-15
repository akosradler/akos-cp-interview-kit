import { Router, Response, Request } from 'express';
import { prisma } from '../index';
import { AuthRequest, requireOwnerOrAdmin } from '../middleware/auth';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Simulated Stripe integration
// In real app would use actual Stripe SDK

// Get billing overview
router.get('/overview', async (req: AuthRequest, res: Response) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.user!.organizationId },
      select: {
        tier: true,
        monthlyBudget: true,
        currentSpend: true,
        stripeCustomerId: true
      }
    });

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Get current month usage
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const usageRecords = await prisma.usageRecord.findMany({
      where: {
        organizationId: req.user!.organizationId,
        periodStart: { gte: startOfMonth }
      }
    });

    const usage = usageRecords.reduce((acc: any, record) => {
      acc[record.metric] = (acc[record.metric] || 0) + record.value;
      return acc;
    }, {});

    // Get recent invoices
    const invoices = await prisma.invoice.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    res.json({
      tier: organization.tier,
      monthlyBudget: organization.monthlyBudget,
      currentSpend: organization.currentSpend,
      usage,
      invoices,
      hasPaymentMethod: !!organization.stripeCustomerId
    });
  } catch (error) {
    console.error('Get billing overview error:', error);
    res.status(500).json({ error: 'Failed to get billing overview' });
  }
});

// Get usage details
router.get('/usage', async (req: AuthRequest, res: Response) => {
  try {
    const { period } = req.query;

    let startDate = new Date();
    if (period === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'year') {
      startDate.setFullYear(startDate.getFullYear() - 1);
    } else {
      // Default to month
      startDate.setMonth(startDate.getMonth() - 1);
    }
    const usage = await prisma.usageRecord.findMany({
      where: {
        organizationId: req.user!.organizationId,
        periodStart: { gte: startDate }
      },
      orderBy: { periodStart: 'desc' }
    });

    res.json(usage);
  } catch (error) {
    console.error('Get usage error:', error);
    res.status(500).json({ error: 'Failed to get usage' });
  }
});

// Record usage
router.post('/usage/record', async (req: AuthRequest, res: Response) => {
  try {
    const { metric, value } = req.body;

    if (!metric || value === undefined) {
      return res.status(400).json({ error: 'metric and value required' });
    }

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const periodEnd = new Date(periodStart);
    periodEnd.setDate(periodEnd.getDate() + 1);

    const existing = await prisma.usageRecord.findFirst({
      where: {
        organizationId: req.user!.organizationId,
        metric,
        periodStart
      }
    });

    if (existing) {
      await prisma.usageRecord.update({
        where: { id: existing.id },
        data: {
          value: existing.value + value
        }
      });
    } else {
      await prisma.usageRecord.create({
        data: {
          id: uuidv4(),
          organizationId: req.user!.organizationId,
          metric,
          value,
          periodStart,
          periodEnd
        }
      });
    }

    // Also update current spend on org
    const costPerUnit = getCostPerUnit(metric);
    await prisma.organization.update({
      where: { id: req.user!.organizationId },
      data: {
        currentSpend: {
          increment: value * costPerUnit
        }
      }
    });

    res.json({ recorded: true });
  } catch (error) {
    console.error('Record usage error:', error);
    res.status(500).json({ error: 'Failed to record usage' });
  }
});

// Get pricing tiers
router.get('/pricing', async (req: AuthRequest, res: Response) => {
  try {
    const pricing = {
      free: {
        name: 'Free',
        price: 0,
        features: {
          events: 10000,
          dashboards: 3,
          users: 2,
          retention: 30
        }
      },
      starter: {
        name: 'Starter',
        price: 29,
        features: {
          events: 100000,
          dashboards: 10,
          users: 5,
          retention: 90
        }
      },
      pro: {
        name: 'Pro',
        price: 99,
        features: {
          events: 1000000,
          dashboards: -1, // unlimited
          users: 20,
          retention: 365
        }
      },
      enterprise: {
        name: 'Enterprise',
        price: -1, // custom
        features: {
          events: -1,
          dashboards: -1,
          users: -1,
          retention: -1
        }
      }
    };

    res.json(pricing);
  } catch (error) {
    console.error('Get pricing error:', error);
    res.status(500).json({ error: 'Failed to get pricing' });
  }
});

// Upgrade plan
router.post('/upgrade', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { tier, paymentMethodId } = req.body;

    if (!tier) {
      return res.status(400).json({ error: 'Tier required' });
    }

    const validTiers = ['free', 'starter', 'pro', 'enterprise'];
    if (!validTiers.includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier' });
    }
    // Just updating the tier without charging!

    // In real implementation:
    // 1. Verify payment method
    // 2. Create Stripe subscription
    // 3. Handle webhook for payment confirmation
    // 4. Then update tier

    const organization = await prisma.organization.update({
      where: { id: req.user!.organizationId },
      data: { tier }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        id: uuidv4(),
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        action: 'billing.tier_changed',
        resourceType: 'organization',
        resourceId: req.user!.organizationId,
        details: { newTier: tier }
      }
    });

    res.json({ tier: organization.tier, message: 'Plan upgraded successfully' });
  } catch (error) {
    console.error('Upgrade error:', error);
    res.status(500).json({ error: 'Failed to upgrade plan' });
  }
});

// Get invoices
router.get('/invoices', async (req: AuthRequest, res: Response) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' }
    });

    res.json(invoices);
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ error: 'Failed to get invoices' });
  }
});

// Get single invoice
router.get('/invoices/:invoiceId', async (req: AuthRequest, res: Response) => {
  try {
    const { invoiceId } = req.params;
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        organizationId: req.user!.organizationId
      }
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json(invoice);
  } catch (error) {
    console.error('Get invoice error:', error);
    res.status(500).json({ error: 'Failed to get invoice' });
  }
});

// Stripe webhook handler
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const event = req.body;

    console.log('Received webhook:', event.type);

    switch (event.type) {
      case 'invoice.paid':
        const invoiceData = event.data.object;
        await prisma.invoice.updateMany({
          where: { stripeInvoiceId: invoiceData.id },
          data: {
            status: 'paid',
            paidAt: new Date()
          }
        });
        break;

      case 'invoice.payment_failed':
        const failedInvoice = event.data.object;
        await prisma.invoice.updateMany({
          where: { stripeInvoiceId: failedInvoice.id },
          data: { status: 'failed' }
        });
        break;

      case 'customer.subscription.deleted':
        // Downgrade to free tier
        const subscription = event.data.object;
        console.log('Subscription deleted:', subscription.id);
        break;

      default:
        console.log('Unhandled webhook type:', event.type);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    // Should return 200 even on error to acknowledge receipt
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Create payment method (simulated)
router.post('/payment-method', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { cardToken } = req.body;

    if (!cardToken) {
      return res.status(400).json({ error: 'Card token required' });
    }
    // Just storing a fake customer ID

    const customerId = `cus_simulated_${uuidv4().slice(0, 8)}`;

    await prisma.organization.update({
      where: { id: req.user!.organizationId },
      data: { stripeCustomerId: customerId }
    });
    console.log(`Created payment method for org ${req.user!.organizationId}: ${cardToken}`);

    res.json({ customerId, message: 'Payment method added' });
  } catch (error) {
    console.error('Add payment method error:', error);
    res.status(500).json({ error: 'Failed to add payment method' });
  }
});

// Set budget alert
router.post('/budget-alert', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { monthlyBudget } = req.body;

    if (typeof monthlyBudget !== 'number' || monthlyBudget < 0) {
      return res.status(400).json({ error: 'Valid monthly budget required' });
    }
    await prisma.organization.update({
      where: { id: req.user!.organizationId },
      data: { monthlyBudget }
    });

    res.json({ monthlyBudget, message: 'Budget alert set' });
  } catch (error) {
    console.error('Set budget alert error:', error);
    res.status(500).json({ error: 'Failed to set budget alert' });
  }
});

// Reset usage (for testing/demo)
router.post('/reset-usage', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    // Delete usage records
    await prisma.usageRecord.deleteMany({
      where: { organizationId: req.user!.organizationId }
    });

    // Reset current spend
    await prisma.organization.update({
      where: { id: req.user!.organizationId },
      data: { currentSpend: 0 }
    });

    res.json({ message: 'Usage reset' });
  } catch (error) {
    console.error('Reset usage error:', error);
    res.status(500).json({ error: 'Failed to reset usage' });
  }
});

// Helper function for cost calculation
function getCostPerUnit(metric: string): number {
  const costs: Record<string, number> = {
    api_calls: 0.0001,
    events_ingested: 0.001,
    storage_mb: 0.01,
    export_rows: 0.00001
  };

  return costs[metric] || 0;
}

export default router;
