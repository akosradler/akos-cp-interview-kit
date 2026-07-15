import { Router, Response } from 'express';
import { prisma } from '../index';
import { AuthRequest } from '../middleware/auth';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

async function resourceBelongsToOrg(
  resourceType: string,
  resourceId: string,
  organizationId: string
): Promise<boolean> {
  if (resourceType === 'dashboard') {
    const dashboard = await prisma.dashboard.findFirst({
      where: { id: resourceId, organizationId },
      select: { id: true },
    });
    return !!dashboard;
  }

  if (resourceType === 'widget') {
    const widget = await prisma.widget.findFirst({
      where: { id: resourceId, organizationId },
      select: { id: true },
    });
    return !!widget;
  }

  return false;
}

// Get comments for a resource
router.get('/:resourceType/:resourceId', async (req: AuthRequest, res: Response) => {
  try {
    const { resourceType, resourceId } = req.params;

    const hasAccess = await resourceBelongsToOrg(
      resourceType,
      resourceId,
      req.user!.organizationId
    );

    if (!hasAccess) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    const comments = await prisma.comment.findMany({
      where: {
        resourceType,
        resourceId,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(comments);
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Failed to get comments' });
  }
});

// Create comment
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { content, resourceType, resourceId, parentId } = req.body;
    if (!content || !resourceType || !resourceId) {
      return res.status(400).json({ error: 'Content, resourceType, and resourceId required' });
    }

    const hasAccess = await resourceBelongsToOrg(
      resourceType,
      resourceId,
      req.user!.organizationId
    );

    if (!hasAccess) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    const comment = await prisma.comment.create({
      data: {
        id: uuidv4(),
        content,
        userId: req.user!.id,
        resourceType,
        resourceId,
        parentId,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
      },
    });

    res.status(201).json(comment);
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// Update comment
router.put('/:commentId', async (req: AuthRequest, res: Response) => {
  try {
    const { commentId } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content required' });
    }
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comment.userId !== req.user!.id) {
      return res.status(403).json({ error: 'Not authorized to edit this comment' });
    }

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: { content },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Update comment error:', error);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// Delete comment
router.delete('/:commentId', async (req: AuthRequest, res: Response) => {
  try {
    const { commentId } = req.params;

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comment.userId !== req.user!.id) {
      return res.status(403).json({ error: 'Not authorized to delete this comment' });
    }
    await prisma.comment.delete({
      where: { id: commentId },
    });

    res.json({ message: 'Comment deleted' });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

export default router;
