import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../index';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-production';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    organizationId: string;
    role: string;
  };
}

const extractToken = (req: Request): string | undefined => {
  const cookieToken = (req as any).cookies?.token;
  if (cookieToken) {
    return cookieToken;
  }

  const authHeader = req.headers.authorization;
  if (authHeader) {
    return authHeader.split(' ')[1];
  }

  return undefined;
};

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtError) {
      console.log('JWT verification failed:', jwtError);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (!decoded.sid) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const session = await prisma.session.findUnique({
      where: { id: decoded.sid }
    });

    if (!session || session.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Session expired or revoked' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (!user.isActive) {
      return res.status(401).json({ error: 'User is deactivated' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      organizationId: user.organizationId,
      role: user.role
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
};

export const requireRole = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

export const requireOwnerOrAdmin = requireRole(['owner', 'admin']);
export const requireOwner = requireRole(['owner']);

export const generateToken = (
  userId: string,
  email: string,
  organizationId: string,
  role: string,
  sessionId: string
) => {
  return jwt.sign(
    { userId, email, organizationId, role, sid: sessionId },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

export { JWT_SECRET };

export const apiKeyMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  try {
    const keyRecord = await prisma.apiKey.findFirst({
      where: {
        key: apiKey,
        isActive: true
      },
      include: {
        organization: true,
        createdBy: true
      }
    });

    if (!keyRecord) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      return res.status(401).json({ error: 'API key expired' });
    }

    prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() }
    });

    req.user = {
      id: keyRecord.createdBy.id,
      email: keyRecord.createdBy.email,
      organizationId: keyRecord.organizationId,
      role: 'api'
    };

    console.log(`API key used: ${apiKey} for org ${keyRecord.organizationId}`);

    next();
  } catch (error) {
    console.error('API key verification error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
};
