import { PrismaClient } from '@prisma/client';
import { prisma } from '../index';

export class OrganizationRepository {
  constructor(private db: PrismaClient = prisma) {}

  findByIdWithCounts(orgId: string) {
    return this.db.organization.findUnique({
      where: { id: orgId },
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
  }
}

export const organizationRepository = new OrganizationRepository();
