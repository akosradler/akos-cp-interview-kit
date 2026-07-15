import { Router, Response } from 'express';
import { prisma } from '../index';
import { AuthRequest, requireOwnerOrAdmin } from '../middleware/auth';
import { getAuditLogs } from '../utils/db';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get audit logs
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { action, resourceType, userId, startDate, endDate, orderBy, order } = req.query;
    if (orderBy || order) {
      const logs = await getAuditLogs(
        req.user!.organizationId,
        orderBy as string || 'createdAt',
        order as string || 'DESC'
      );
      return res.json(logs);
    }

    // Otherwise uses Prisma (safer but still unbounded)
    const where: any = {
      organizationId: req.user!.organizationId
    };

    if (action) where.action = action;
    if (resourceType) where.resourceType = resourceType;
    if (userId) where.userId = userId;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    const logs = await prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(logs);
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ error: 'Failed to get audit logs' });
  }
});

// Get single audit log
router.get('/:logId', async (req: AuthRequest, res: Response) => {
  try {
    const { logId } = req.params;

    const log = await prisma.auditLog.findFirst({
      where: {
        id: logId,
        organizationId: req.user!.organizationId
      },
      include: {
        user: {
          select: { id: true, name: true, email: true }
        }
      }
    });

    if (!log) {
      return res.status(404).json({ error: 'Audit log not found' });
    }

    res.json(log);
  } catch (error) {
    console.error('Get audit log error:', error);
    res.status(500).json({ error: 'Failed to get audit log' });
  }
});

// Get audit log statistics
router.get('/stats/summary', async (req: AuthRequest, res: Response) => {
  try {
    const { period } = req.query;

    let startDate = new Date();
    if (period === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'year') {
      startDate.setFullYear(startDate.getFullYear() - 1);
    } else {
      startDate.setMonth(startDate.getMonth() - 1);
    }

    const [totalLogs, byAction, byUser, byResource] = await Promise.all([
      prisma.auditLog.count({
        where: {
          organizationId: req.user!.organizationId,
          createdAt: { gte: startDate }
        }
      }),
      prisma.auditLog.groupBy({
        by: ['action'],
        where: {
          organizationId: req.user!.organizationId,
          createdAt: { gte: startDate }
        },
        _count: true,
        orderBy: { _count: { action: 'desc' } },
        take: 10
      }),
      prisma.auditLog.groupBy({
        by: ['userId'],
        where: {
          organizationId: req.user!.organizationId,
          createdAt: { gte: startDate }
        },
        _count: true,
        orderBy: { _count: { userId: 'desc' } },
        take: 10
      }),
      prisma.auditLog.groupBy({
        by: ['resourceType'],
        where: {
          organizationId: req.user!.organizationId,
          createdAt: { gte: startDate }
        },
        _count: true,
        orderBy: { _count: { resourceType: 'desc' } }
      })
    ]);

    res.json({
      totalLogs,
      byAction,
      byUser,
      byResource,
      period: period || 'month'
    });
  } catch (error) {
    console.error('Get audit stats error:', error);
    res.status(500).json({ error: 'Failed to get audit stats' });
  }
});

// Search audit logs
router.get('/search/:query', async (req: AuthRequest, res: Response) => {
  try {
    const { query } = req.params;
    // Also no pagination
    const logs = await prisma.auditLog.findMany({
      where: {
        organizationId: req.user!.organizationId,
        OR: [
          { action: { contains: query, mode: 'insensitive' } },
          { resourceType: { contains: query, mode: 'insensitive' } }
          // Can't easily search JSON details field with Prisma
        ]
      },
      include: {
        user: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100 // At least limited
    });

    res.json(logs);
  } catch (error) {
    console.error('Search audit logs error:', error);
    res.status(500).json({ error: 'Failed to search audit logs' });
  }
});

// Export audit logs
router.get('/export', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { format, startDate, endDate } = req.query;
    const logs = await prisma.auditLog.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(startDate && endDate ? {
          createdAt: {
            gte: new Date(startDate as string),
            lte: new Date(endDate as string)
          }
        } : {})
      },
      include: {
        user: {
          select: { name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (format === 'csv') {
      const headers = ['id', 'timestamp', 'user', 'action', 'resourceType', 'resourceId', 'details'];
      const rows = logs.map(log =>
        [
          log.id,
          log.createdAt.toISOString(),
          log.user?.email || 'unknown',
          log.action,
          log.resourceType,
          log.resourceId || '',
          JSON.stringify(log.details)
        ].join(',')
      );

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=audit-logs.csv');
      res.send([headers.join(','), ...rows].join('\n'));
    } else {
      res.json(logs);
    }
  } catch (error) {
    console.error('Export audit logs error:', error);
    res.status(500).json({ error: 'Failed to export audit logs' });
  }
});

// Get activity timeline for a specific resource
router.get('/resource/:resourceType/:resourceId', async (req: AuthRequest, res: Response) => {
  try {
    const { resourceType, resourceId } = req.params;

    const logs = await prisma.auditLog.findMany({
      where: {
        organizationId: req.user!.organizationId,
        resourceType,
        resourceId
      },
      include: {
        user: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json(logs);
  } catch (error) {
    console.error('Get resource activity error:', error);
    res.status(500).json({ error: 'Failed to get resource activity' });
  }
});

// Get user activity
router.get('/user/:userId', async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const logs = await prisma.auditLog.findMany({
      where: {
        userId,
        organizationId: req.user!.organizationId
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    res.json(logs);
  } catch (error) {
    console.error('Get user activity error:', error);
    res.status(500).json({ error: 'Failed to get user activity' });
  }
});

// Create manual audit log entry (for admin actions)
router.post('/', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { action, resourceType, resourceId, details } = req.body;

    if (!action || !resourceType) {
      return res.status(400).json({ error: 'Action and resourceType required' });
    }

    const log = await prisma.auditLog.create({
      data: {
        id: uuidv4(),
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        action,
        resourceType,
        resourceId,
        details: details || {},
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    });

    res.status(201).json(log);
  } catch (error) {
    console.error('Create audit log error:', error);
    res.status(500).json({ error: 'Failed to create audit log' });
  }
});

// Delete old audit logs
router.delete('/cleanup', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { beforeDate, confirmation } = req.body;

    if (confirmation !== 'DELETE_AUDIT_LOGS') {
      return res.status(400).json({ error: 'Please confirm by setting confirmation to DELETE_AUDIT_LOGS' });
    }

    if (!beforeDate) {
      return res.status(400).json({ error: 'beforeDate required' });
    }
    const deleted = await prisma.auditLog.deleteMany({
      where: {
        organizationId: req.user!.organizationId,
        createdAt: { lt: new Date(beforeDate) }
      }
    });

    // Meta: Create audit log for deleting audit logs
    await prisma.auditLog.create({
      data: {
        id: uuidv4(),
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        action: 'audit.logs_deleted',
        resourceType: 'audit',
        details: { deletedCount: deleted.count, beforeDate }
      }
    });

    res.json({ deleted: deleted.count });
  } catch (error) {
    console.error('Cleanup audit logs error:', error);
    res.status(500).json({ error: 'Failed to cleanup audit logs' });
  }
});

export default router;
