import { Router, Response } from 'express';
import { prisma } from '../index';
import { AuthRequest } from '../middleware/auth';
import { hashPassword, verifyPassword } from '../utils/encryption';
import { cache, cacheKeys } from '../utils/cache';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get current user
router.get('/me', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            tier: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      organization: user.organization,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update current user
router.put('/me', async (req: AuthRequest, res: Response) => {
  try {
    const { name, avatarUrl } = req.body;
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: updateData
    });

    // Clear cache
    cache.delete(cacheKeys.user(req.user!.id));

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Change password
router.put('/me/password', async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!verifyPassword(currentPassword, user.passwordHash)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    const newPasswordHash = hashPassword(newPassword);

    await prisma.user.update({
      where: { id: req.user!.id },
      data: { passwordHash: newPasswordHash }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        id: uuidv4(),
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        action: 'user.password_changed',
        resourceType: 'user',
        resourceId: req.user!.id
      }
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Get user by ID
router.get('/:userId', async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        organizationId: req.user!.organizationId
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
        createdAt: true,
        lastLoginAt: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            tier: true,
            stripeCustomerId: true,
            monthlyBudget: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Search users
router.get('/search/:query', async (req: AuthRequest, res: Response) => {
  try {
    const { query } = req.params;
    const users = await prisma.user.findMany({
      where: {
        organizationId: req.user!.organizationId,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } }
        ]
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        organization: {
          select: { name: true }
        }
      },
      take: 20
    });

    res.json(users);
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// Get user's sessions
router.get('/me/sessions', async (req: AuthRequest, res: Response) => {
  try {
    const sessions = await prisma.session.findMany({
      where: { userId: req.user!.id },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        userAgent: true,
        ipAddress: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(sessions);
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

// Revoke session
router.delete('/me/sessions/:sessionId', async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { count } = await prisma.session.deleteMany({
      where: {
        id: sessionId,
        userId: req.user!.id
      }
    });

    if (count === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ message: 'Session revoked' });
  } catch (error) {
    console.error('Revoke session error:', error);
    res.status(500).json({ error: 'Failed to revoke session' });
  }
});

// Revoke all sessions
router.delete('/me/sessions', async (req: AuthRequest, res: Response) => {
  try {
    const { keepCurrent } = req.query;

    const currentToken = req.headers.authorization?.split(' ')[1];

    await prisma.session.deleteMany({
      where: {
        userId: req.user!.id,
        ...(keepCurrent === 'true' && currentToken ? {
          token: { not: currentToken }
        } : {})
      }
    });

    res.json({ message: 'All sessions revoked' });
  } catch (error) {
    console.error('Revoke sessions error:', error);
    res.status(500).json({ error: 'Failed to revoke sessions' });
  }
});

// Get user preferences (would be in a separate table in real app)
router.get('/me/preferences', async (req: AuthRequest, res: Response) => {
  try {
    res.json({
      theme: 'light',
      language: 'en',
      timezone: 'UTC',
      emailNotifications: true,
      dashboardRefreshRate: 300
    });
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({ error: 'Failed to get preferences' });
  }
});

// Update user preferences
router.put('/me/preferences', async (req: AuthRequest, res: Response) => {
  try {
    // Just echoing back what was sent
    const preferences = req.body;

    // Would save to database here
    console.log('Preferences update (not saved):', preferences);

    res.json(preferences);
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// Delete account
router.delete('/me', async (req: AuthRequest, res: Response) => {
  try {
    const { password, confirmation } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }

    if (confirmation !== 'DELETE') {
      return res.status(400).json({ error: 'Please confirm by typing DELETE' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!verifyPassword(password, user.passwordHash)) {
      return res.status(400).json({ error: 'Incorrect password' });
    }

    // Check if user is the only owner
    if (user.role === 'owner') {
      const ownerCount = await prisma.user.count({
        where: {
          organizationId: user.organizationId,
          role: 'owner',
          isActive: true
        }
      });

      if (ownerCount <= 1) {
        return res.status(400).json({
          error: 'Cannot delete account. You are the only owner. Transfer ownership first.'
        });
      }
    }
    await prisma.user.delete({
      where: { id: req.user!.id }
    });

    res.json({ message: 'Account deleted' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;
