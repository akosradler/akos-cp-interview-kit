import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('../src/index', () => ({
  prisma: {}
}));

import { OrganizationService } from '../src/services/organizationService';
import { OrganizationRepository } from '../src/repositories/organizationRepository';

describe('OrganizationService.getCurrentOrganization', () => {
  const mockRepo = {
    findByIdWithCounts: jest.fn()
  };
  const mockCache = {
    get: jest.fn(),
    set: jest.fn()
  };

  let service: OrganizationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrganizationService(mockRepo as any, mockCache as any);
  });

  it('returns cached organization without hitting the repository', async () => {
    const cachedOrg = { id: 'org-1', name: 'Cached Org' };
    mockCache.get.mockReturnValue(cachedOrg);

    const result = await service.getCurrentOrganization('org-1');

    expect(result).toBe(cachedOrg);
    expect(mockCache.get).toHaveBeenCalledWith('org:org-1');
    expect(mockCache.set).not.toHaveBeenCalled();
  });

  it('fetches from the repository on cache miss and writes to cache', async () => {
    const fetchedOrg = { id: 'org-1', name: 'Fetched Org' };
    mockCache.get.mockReturnValue(undefined);
    mockRepo.findByIdWithCounts.mockResolvedValue(fetchedOrg);

    const result = await service.getCurrentOrganization('org-1');

    expect(result).toBe(fetchedOrg);
    expect(mockRepo.findByIdWithCounts).toHaveBeenCalledWith('org-1');
    expect(mockCache.set).toHaveBeenCalledWith('org:org-1', fetchedOrg, 300);
  });

  it('returns null and does not cache when organization is not found', async () => {
    mockCache.get.mockReturnValue(undefined);
    mockRepo.findByIdWithCounts.mockResolvedValue(null);

    const result = await service.getCurrentOrganization('org-1');

    expect(result).toBeNull();
    expect(mockRepo.findByIdWithCounts).toHaveBeenCalledWith('org-1');
    expect(mockCache.set).not.toHaveBeenCalled();
  });
});

