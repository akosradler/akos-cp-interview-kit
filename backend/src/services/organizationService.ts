import { cache, cacheKeys } from '../utils/cache';
import { organizationRepository, OrganizationRepository } from '../repositories/organizationRepository';

type CacheClient = Pick<typeof cache, 'get' | 'set'>;

export class OrganizationService {
  constructor(
    private repo: OrganizationRepository = organizationRepository,
    private cacheClient: CacheClient = cache
  ) {}

  async getCurrentOrganization(orgId: string) {
    const cacheKey = cacheKeys.organization(orgId);

    const cached = this.cacheClient.get(cacheKey);
    if (cached) {
      return cached;
    }

    const organization = await this.repo.findByIdWithCounts(orgId);

    if (organization) {
      this.cacheClient.set(cacheKey, organization, 300);
    }

    return organization;
  }
}

export const organizationService = new OrganizationService();
