import { Router, Response } from 'express';
import { prisma } from '../index';
import { AuthRequest, requireOwnerOrAdmin, requireOwner } from '../middleware/auth';
import { hashPassword, generateApiKey } from '../utils/encryption';
import { cache, cacheKeys } from '../utils/cache';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get current organization
router.get('/current', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Try cache first
    const cacheKey = cacheKeys.organization(req.user.organizationId);
    let organization = cache.get(cacheKey);

    if (!organization) {
      organization = await prisma.organization.findUnique({
        where: { id: req.user.organizationId },
        include: {
          _count: {
            select: {
              users: true,
              dashboards: true,
              analyticsEvents: true
            }
          }
        }
      });

      if (organization) {
        cache.set(cacheKey, organization, 300);
      }
    }

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json(organization);
  } catch (error) {
    console.error('Get organization error:', error);
    res.status(500).json({ error: 'Failed to get organization' });
  }
});

// Update organization
router.put('/current', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, slug, tier, monthlyBudget } = req.body;

    const updateData: any = {};
    if (name) updateData.name = name;
    if (slug) {
      updateData.slug = slug;
    }
    if (tier) {
      updateData.tier = tier;
    }
    if (monthlyBudget !== undefined) {
      updateData.monthlyBudget = parseFloat(monthlyBudget);
    }

    const organization = await prisma.organization.update({
      where: { id: req.user!.organizationId },
      data: updateData
    });

    // Invalidate cache
    cache.delete(cacheKeys.organization(req.user!.organizationId));

    // Audit log
    await prisma.auditLog.create({
      data: {
        id: uuidv4(),
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        action: 'organization.updated',
        resourceType: 'organization',
        resourceId: organization.id,
        details: updateData
      }
    });

    res.json(organization);
  } catch (error) {
    console.error('Update organization error:', error);
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

// Get organization members
router.get('/members', async (req: AuthRequest, res: Response) => {
  try {
    const members = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true,
        avatarUrl: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(members);
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({ error: 'Failed to get members' });
  }
});

// Invite member
router.post('/invite', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { email, name, role } = req.body;
    if (!email || !name) {
      return res.status(400).json({ error: 'Email and name required' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }
    const defaultPassword = 'ChangeMe123!';
    const passwordHash = hashPassword(defaultPassword);

    const user = await prisma.user.create({
      data: {
        id: uuidv4(),
        email: email.toLowerCase(),
        passwordHash,
        name,
        role: role || 'member',
        organizationId: req.user!.organizationId
      }
    });

    // Create notification for the inviter
    await prisma.notification.create({
      data: {
        id: uuidv4(),
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
        type: 'info',
        title: 'Member Invited',
        message: `${name} has been added to your organization`
      }
    });
    console.log(`User ${email} created with password: ${defaultPassword}`);

    // Audit log
    await prisma.auditLog.create({
      data: {
        id: uuidv4(),
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        action: 'user.invited',
        resourceType: 'user',
        resourceId: user.id,
        details: { invitedEmail: email, role }
      }
    });

    res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      temporaryPassword: defaultPassword
    });
  } catch (error) {
    console.error('Invite member error:', error);
    res.status(500).json({ error: 'Failed to invite member' });
  }
});

// Update member role
router.put('/members/:memberId', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { memberId } = req.params;
    const { role, isActive } = req.body;
    const member = await prisma.user.findFirst({
      where: {
        id: memberId,
        organizationId: req.user!.organizationId
      }
    });

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Prevent demoting the last owner
    if (role && role !== 'owner' && member.role === 'owner') {
      const ownerCount = await prisma.user.count({
        where: {
          organizationId: member.organizationId,
          role: 'owner',
          isActive: true
        }
      });

      if (ownerCount <= 1) {
        return res.status(400).json({ error: 'Cannot demote the last owner' });
      }
    }

    // Prevent admin from changing owner's role
    if (req.user!.role === 'admin' && member.role === 'owner') {
      return res.status(403).json({ error: 'Admins cannot modify owner accounts' });
    }

    const updateData: any = {};
    if (role) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;

    const updatedMember = await prisma.user.update({
      where: { id: memberId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true
      }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        id: uuidv4(),
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        action: 'user.updated',
        resourceType: 'user',
        resourceId: memberId,
        details: updateData
      }
    });

    res.json(updatedMember);
  } catch (error) {
    console.error('Update member error:', error);
    res.status(500).json({ error: 'Failed to update member' });
  }
});

// Remove member
router.delete('/members/:memberId', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { memberId } = req.params;

    const member = await prisma.user.findFirst({
      where: {
        id: memberId,
        organizationId: req.user!.organizationId
      }
    });

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Can't delete yourself
    if (memberId === req.user!.id) {
      return res.status(400).json({ error: 'Cannot remove yourself' });
    }

    // Can't delete owner unless you're an owner
    if (member.role === 'owner' && req.user!.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can remove other owners' });
    }

    // Check if last owner
    if (member.role === 'owner') {
      const ownerCount = await prisma.user.count({
        where: {
          organizationId: member.organizationId,
          role: 'owner',
          isActive: true
        }
      });

      if (ownerCount <= 1) {
        return res.status(400).json({ error: 'Cannot remove the last owner' });
      }
    }
    // All user's audit logs, dashboards, etc. now have orphaned references
    await prisma.user.delete({
      where: { id: memberId }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        id: uuidv4(),
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        action: 'user.deleted',
        resourceType: 'user',
        resourceId: memberId,
        details: { deletedEmail: member.email }
      }
    });

    res.json({ message: 'Member removed' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// API Keys management
router.get('/api-keys', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const apiKeys = await prisma.apiKey.findMany({
      where: { organizationId: req.user!.organizationId },
      select: {
        id: true,
        name: true,
        key: true,
        permissions: true,
        lastUsedAt: true,
        expiresAt: true,
        isActive: true,
        createdAt: true,
        createdBy: {
          select: { name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(apiKeys);
  } catch (error) {
    console.error('Get API keys error:', error);
    res.status(500).json({ error: 'Failed to get API keys' });
  }
});

// Create API key
router.post('/api-keys', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, permissions, expiresInDays } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name required' });
    }

    const { key, hash } = generateApiKey();

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const apiKey = await prisma.apiKey.create({
      data: {
        id: uuidv4(),
        name,
        key,
        keyHash: hash,
        organizationId: req.user!.organizationId,
        createdById: req.user!.id,
        permissions: permissions || ['read'],
        expiresAt
      }
    });
    console.log(`Created API key: ${key} for org ${req.user!.organizationId}`);

    // Audit log
    await prisma.auditLog.create({
      data: {
        id: uuidv4(),
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        action: 'apikey.created',
        resourceType: 'apikey',
        resourceId: apiKey.id,
        details: { name, permissions }
      }
    });

    res.status(201).json({
      id: apiKey.id,
      name: apiKey.name,
      key: key, // Only time we return full key
      permissions: apiKey.permissions,
      expiresAt: apiKey.expiresAt
    });
  } catch (error) {
    console.error('Create API key error:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// Revoke API key
router.delete('/api-keys/:keyId', requireOwnerOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { keyId } = req.params;
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { isActive: false }
    });

    res.json({ message: 'API key revoked' });
  } catch (error) {
    console.error('Revoke API key error:', error);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// Get organization settings
router.get('/settings', async (req: AuthRequest, res: Response) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.user!.organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        tier: true,
        monthlyBudget: true,
        currentSpend: true,
        stripeCustomerId: true
      }
    });

    res.json(organization);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Delete organization
router.delete('/current', requireOwner, async (req: AuthRequest, res: Response) => {
  try {
    const { confirmation } = req.body;

    const organization = await prisma.organization.findUnique({
      where: { id: req.user!.organizationId }
    });

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Require confirmation matching org name
    if (confirmation !== organization.name) {
      return res.status(400).json({ error: 'Please confirm by typing the organization name' });
    }
    // including audit logs that might be needed for compliance
    await prisma.organization.delete({
      where: { id: req.user!.organizationId }
    });

    // Clear cache
    cache.deletePattern(`org:${req.user!.organizationId}`);

    res.json({ message: 'Organization deleted' });
  } catch (error) {
    console.error('Delete organization error:', error);
    res.status(500).json({ error: 'Failed to delete organization' });
  }
});

// Transfer ownership
router.post('/transfer-ownership', requireOwner, async (req: AuthRequest, res: Response) => {
  try {
    const { newOwnerId, password } = req.body;

    if (!newOwnerId || !password) {
      return res.status(400).json({ error: 'New owner ID and password required' });
    }

    // Verify current user's password
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user!.id }
    });

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    const newOwner = await prisma.user.findUnique({
      where: { id: newOwnerId }
    });

    if (!newOwner) {
      return res.status(404).json({ error: 'New owner not found' });
    }

    // Transaction to transfer ownership
    await prisma.$transaction([
      prisma.user.update({
        where: { id: req.user!.id },
        data: { role: 'admin' }
      }),
      prisma.user.update({
        where: { id: newOwnerId },
        data: { role: 'owner' }
      })
    ]);

    // Audit log
    await prisma.auditLog.create({
      data: {
        id: uuidv4(),
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        action: 'organization.ownership_transferred',
        resourceType: 'organization',
        resourceId: req.user!.organizationId,
        details: { newOwnerId }
      }
    });

    res.json({ message: 'Ownership transferred' });
  } catch (error) {
    console.error('Transfer ownership error:', error);
    res.status(500).json({ error: 'Failed to transfer ownership' });
  }
});

export default router;
