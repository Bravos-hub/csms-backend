import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Server } from 'http';
import {
  bootstrapBatteryProviderTestApp,
  createPrismaMock,
  MockPrisma,
} from './test-bootstrap';
import { createProviderAuthCookie } from './auth-helpers';

describe('Battery Provider Console (e2e)', () => {
  let app: INestApplication;
  let prismaMock: MockPrisma;

  const tenantId = 'tenant-1';
  const providerId = 'provider-1';
  const stationId = 'station-1';
  const cabinetId = 'cabinet-1';
  const packId = 'pack-1';
  const alertId = 'alert-1';

  beforeEach(async () => {
    prismaMock = createPrismaMock();
    ({ app } = await bootstrapBatteryProviderTestApp(prismaMock));
  });

  afterEach(async () => {
    await app.close();
  });

  function httpServer(): Server {
    return app.getHttpServer() as Server;
  }

  function responseBody<T>(response: { body: unknown }): T {
    return response.body as T;
  }

  function firstMockArg<T>(mock: jest.Mock): T | undefined {
    const calls = mock.mock.calls as Array<[T]>;
    return calls[0]?.[0];
  }

  describe('Provider Login & Scope', () => {
    it('GET /cpo/battery-provider/overview returns KPIs for assigned scope', async () => {
      prismaMock.batteryProviderUserScope.findFirst.mockResolvedValue({
        userId: 'user-1',
        tenantId,
        providerId,
        role: 'ADMIN',
        assignedStationIds: [stationId],
        assignedCabinetIds: [cabinetId],
      });

      prismaMock.station.count.mockResolvedValue(1);
      prismaMock.batteryCabinet.count.mockResolvedValue(1);
      prismaMock.batteryPack.aggregate.mockResolvedValue({
        _count: { id: 4 },
        _avg: { soc: 85, soh: 92 },
      });
      prismaMock.batteryProviderAlert.count.mockResolvedValue(0);
      prismaMock.batteryPack.count.mockResolvedValue(3);

      const cookie = createProviderAuthCookie(app, {
        sub: 'user-1',
        tenantId,
        activeTenantId: tenantId,
        selectedTenantId: tenantId,
      });

      const response = await request(httpServer())
        .get('/cpo/battery-provider/overview')
        .set('Cookie', cookie);
      const body = responseBody<{
        swapReadinessScore: number;
        assignedStations: number;
        activeCabinets: number;
        activePacks: number;
        averageSoc: number;
        averageSoh: number;
        openCriticalAlerts: number;
      }>(response);

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        assignedStations: 1,
        activeCabinets: 1,
        activePacks: 4,
        averageSoc: 85,
        averageSoh: 92,
        openCriticalAlerts: 0,
      });
      expect(body.swapReadinessScore).toBeGreaterThanOrEqual(0);
      expect(body.swapReadinessScore).toBeLessThanOrEqual(100);
    });

    it('GET /cpo/battery-provider/packs enforces station scope', async () => {
      prismaMock.batteryProviderUserScope.findFirst.mockResolvedValue({
        userId: 'user-1',
        tenantId,
        providerId,
        role: 'ADMIN',
        assignedStationIds: [stationId],
        assignedCabinetIds: [],
      });

      prismaMock.batteryPack.findMany.mockResolvedValue([
        { id: packId, serialNumber: 'PACK-001', status: 'READY', soc: 94 },
      ]);
      prismaMock.batteryPack.count.mockResolvedValue(1);

      const cookie = createProviderAuthCookie(app, {
        sub: 'user-1',
        tenantId,
        activeTenantId: tenantId,
        selectedTenantId: tenantId,
      });

      const response = await request(httpServer())
        .get('/cpo/battery-provider/packs')
        .set('Cookie', cookie);
      const body = responseBody<{ items: Array<{ id: string }> }>(response);

      expect(response.status).toBe(200);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(packId);

      // Verify scope was applied in the Prisma query
      const findManyCall = firstMockArg<{ where?: unknown }>(
        prismaMock.batteryPack.findMany,
      );
      expect(findManyCall?.where).toBeDefined();
    });
  });

  describe('Pack Operations', () => {
    beforeEach(() => {
      prismaMock.batteryProviderUserScope.findFirst.mockResolvedValue({
        userId: 'user-1',
        tenantId,
        providerId,
        role: 'ADMIN',
        assignedStationIds: [],
        assignedCabinetIds: [],
      });
    });

    it('POST /cpo/battery-provider/packs/:packId/quarantine transitions pack status', async () => {
      prismaMock.batteryPack.findFirst.mockResolvedValue({
        id: packId,
        serialNumber: 'PACK-001',
        status: 'READY',
      });
      prismaMock.batteryPack.update.mockResolvedValue({
        id: packId,
        status: 'QUARANTINED',
      });
      prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

      const cookie = createProviderAuthCookie(app, {
        sub: 'user-1',
        tenantId,
        activeTenantId: tenantId,
        selectedTenantId: tenantId,
      });

      const response = await request(httpServer())
        .post(`/cpo/battery-provider/packs/${packId}/quarantine`)
        .set('Cookie', cookie)
        .send({ reason: 'Temperature spike detected' });
      const body = responseBody<{ status: string }>(response);

      expect(response.status).toBe(201);
      expect(body.status).toBe('QUARANTINED');
      expect(prismaMock.auditLog.create).toHaveBeenCalled();
    });

    it('POST /cpo/battery-provider/packs/:packId/release transitions pack back to READY', async () => {
      prismaMock.batteryPack.findFirst.mockResolvedValue({
        id: packId,
        serialNumber: 'PACK-001',
        status: 'QUARANTINED',
      });
      prismaMock.batteryPack.update.mockResolvedValue({
        id: packId,
        status: 'READY',
      });
      prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });

      const cookie = createProviderAuthCookie(app, {
        sub: 'user-1',
        tenantId,
        activeTenantId: tenantId,
        selectedTenantId: tenantId,
      });

      const response = await request(httpServer())
        .post(`/cpo/battery-provider/packs/${packId}/release`)
        .set('Cookie', cookie)
        .send({ reason: 'Inspection passed' });
      const body = responseBody<{ status: string }>(response);

      expect(response.status).toBe(201);
      expect(body.status).toBe('READY');
    });
  });

  describe('Cabinet Operations', () => {
    beforeEach(() => {
      prismaMock.batteryProviderUserScope.findFirst.mockResolvedValue({
        userId: 'user-1',
        tenantId,
        providerId,
        role: 'ADMIN',
        assignedStationIds: [],
        assignedCabinetIds: [],
      });
    });

    it('POST /cpo/battery-provider/cabinets/:cabinetId/maintenance-mode sets MAINTENANCE', async () => {
      prismaMock.batteryCabinet.findFirst.mockResolvedValue({
        id: cabinetId,
        cabinetId: 'CAB-001',
        status: 'ONLINE',
      });
      prismaMock.batteryCabinet.update.mockResolvedValue({
        id: cabinetId,
        status: 'MAINTENANCE',
      });
      prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-3' });

      const cookie = createProviderAuthCookie(app, {
        sub: 'user-1',
        tenantId,
        activeTenantId: tenantId,
        selectedTenantId: tenantId,
      });

      const response = await request(httpServer())
        .post(`/cpo/battery-provider/cabinets/${cabinetId}/maintenance-mode`)
        .set('Cookie', cookie);
      const body = responseBody<{ status: string }>(response);

      expect(response.status).toBe(201);
      expect(body.status).toBe('MAINTENANCE');
    });

    it('POST /cpo/battery-provider/cabinets/:cabinetId/slots/:slotId/disable disables slot', async () => {
      prismaMock.batteryCabinet.findFirst.mockResolvedValue({
        id: cabinetId,
        cabinetId: 'CAB-001',
      });
      prismaMock.batteryCabinetSlot.findFirst.mockResolvedValue({
        id: 'slot-1',
        cabinetId,
        slotNumber: 1,
        isEnabled: true,
      });
      prismaMock.batteryCabinetSlot.update.mockResolvedValue({
        id: 'slot-1',
        isEnabled: false,
      });
      prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-4' });

      const cookie = createProviderAuthCookie(app, {
        sub: 'user-1',
        tenantId,
        activeTenantId: tenantId,
        selectedTenantId: tenantId,
      });

      const response = await request(httpServer())
        .post(
          `/cpo/battery-provider/cabinets/${cabinetId}/slots/slot-1/disable`,
        )
        .set('Cookie', cookie);
      const body = responseBody<{ isEnabled: boolean }>(response);

      expect(response.status).toBe(201);
      expect(body.isEnabled).toBe(false);
    });
  });

  describe('Alert Lifecycle', () => {
    beforeEach(() => {
      prismaMock.batteryProviderUserScope.findFirst.mockResolvedValue({
        userId: 'user-1',
        tenantId,
        providerId,
        role: 'ADMIN',
        assignedStationIds: [],
        assignedCabinetIds: [],
      });
    });

    it('POST /cpo/battery-provider/alerts/:alertId/acknowledge sets ACKNOWLEDGED', async () => {
      prismaMock.batteryProviderAlert.findFirst.mockResolvedValue({
        id: alertId,
        status: 'OPEN',
      });
      prismaMock.batteryProviderAlert.update.mockResolvedValue({
        id: alertId,
        status: 'ACKNOWLEDGED',
        acknowledgedBy: 'user-1',
      });
      prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-5' });

      const cookie = createProviderAuthCookie(app, {
        sub: 'user-1',
        tenantId,
        activeTenantId: tenantId,
        selectedTenantId: tenantId,
      });

      const response = await request(httpServer())
        .post(`/cpo/battery-provider/alerts/${alertId}/acknowledge`)
        .set('Cookie', cookie);
      const body = responseBody<{ status: string }>(response);

      expect(response.status).toBe(201);
      expect(body.status).toBe('ACKNOWLEDGED');
    });

    it('POST /cpo/battery-provider/alerts/:alertId/resolve sets RESOLVED', async () => {
      prismaMock.batteryProviderAlert.findFirst.mockResolvedValue({
        id: alertId,
        status: 'ASSIGNED',
      });
      prismaMock.batteryProviderAlert.update.mockResolvedValue({
        id: alertId,
        status: 'RESOLVED',
        resolvedBy: 'user-1',
      });
      prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-6' });

      const cookie = createProviderAuthCookie(app, {
        sub: 'user-1',
        tenantId,
        activeTenantId: tenantId,
        selectedTenantId: tenantId,
      });

      const response = await request(httpServer())
        .post(`/cpo/battery-provider/alerts/${alertId}/resolve`)
        .set('Cookie', cookie)
        .send({ reason: 'Technician fixed the issue' });
      const body = responseBody<{ status: string }>(response);

      expect(response.status).toBe(201);
      expect(body.status).toBe('RESOLVED');
    });
  });

  describe('Maintenance Workflow', () => {
    beforeEach(() => {
      prismaMock.batteryProviderUserScope.findFirst.mockResolvedValue({
        userId: 'user-1',
        tenantId,
        providerId,
        role: 'ADMIN',
        assignedStationIds: [stationId],
        assignedCabinetIds: [],
      });
    });

    it('POST /cpo/battery-provider/maintenance creates an incident', async () => {
      prismaMock.station.findMany.mockResolvedValue([{ id: stationId }]);
      prismaMock.incident.create.mockResolvedValue({
        id: 'incident-1',
        stationId,
        title: 'Pack inspection required',
        status: 'OPEN',
      });
      prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-7' });

      const cookie = createProviderAuthCookie(app, {
        sub: 'user-1',
        tenantId,
        activeTenantId: tenantId,
        selectedTenantId: tenantId,
      });

      const response = await request(httpServer())
        .post('/cpo/battery-provider/maintenance')
        .set('Cookie', cookie)
        .send({
          assetType: 'PACK',
          assetId: packId,
          stationId,
          title: 'Pack inspection required',
          severity: 'HIGH',
        });
      const body = responseBody<{ title: string }>(response);

      expect(response.status).toBe(201);
      expect(body.title).toBe('Pack inspection required');
    });

    it('POST /cpo/battery-provider/maintenance/:ticketId/close closes the ticket', async () => {
      prismaMock.station.findMany.mockResolvedValue([{ id: stationId }]);
      prismaMock.incident.findFirst.mockResolvedValue({
        id: 'incident-1',
        stationId,
        status: 'OPEN',
      });
      prismaMock.incident.update.mockResolvedValue({
        id: 'incident-1',
        status: 'CLOSED',
      });
      prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-8' });

      const cookie = createProviderAuthCookie(app, {
        sub: 'user-1',
        tenantId,
        activeTenantId: tenantId,
        selectedTenantId: tenantId,
      });

      const response = await request(httpServer())
        .post('/cpo/battery-provider/maintenance/incident-1/close')
        .set('Cookie', cookie)
        .send({ notes: 'Resolved on site' });
      const body = responseBody<{ status: string }>(response);

      expect(response.status).toBe(201);
      expect(body.status).toBe('CLOSED');
    });
  });

  describe('SLA Read-Only', () => {
    beforeEach(() => {
      prismaMock.batteryProviderUserScope.findFirst.mockResolvedValue({
        userId: 'user-1',
        tenantId,
        providerId,
        role: 'ADMIN',
        assignedStationIds: [],
        assignedCabinetIds: [],
      });
    });

    it('GET /cpo/battery-provider/sla returns SLA data', async () => {
      prismaMock.batteryProviderSlaSnapshot.findFirst.mockResolvedValue({
        id: 'sla-1',
        tenantId,
        providerId,
        providerUptimePct: 99,
        cabinetUptimePct: 98,
        packAvailabilityPct: 95,
        failedSwapRatePct: 2,
        slaBreaches: 1,
      });

      const cookie = createProviderAuthCookie(app, {
        sub: 'user-1',
        tenantId,
        activeTenantId: tenantId,
        selectedTenantId: tenantId,
      });

      const response = await request(httpServer())
        .get('/cpo/battery-provider/sla')
        .set('Cookie', cookie);
      const body = responseBody<{ providerUptimePct: number }>(response);

      expect(response.status).toBe(200);
      expect(body.providerUptimePct).toBe(99);
    });

    it('GET /cpo/battery-provider/reports/faults returns grouped faults', async () => {
      prismaMock.batteryProviderAlert.groupBy.mockResolvedValue([
        { category: 'CABINET_FAULT', severity: 'HIGH', _count: { id: 3 } },
        { category: 'PACK_DEGRADATION', severity: 'MEDIUM', _count: { id: 2 } },
      ]);

      const cookie = createProviderAuthCookie(app, {
        sub: 'user-1',
        tenantId,
        activeTenantId: tenantId,
        selectedTenantId: tenantId,
      });

      const response = await request(httpServer())
        .get('/cpo/battery-provider/reports/faults')
        .query({ dateFrom: '2026-01-01', dateTo: '2026-01-31' })
        .set('Cookie', cookie);
      const body = responseBody<{ faultBreakdown: unknown[] }>(response);

      expect(response.status).toBe(200);
      expect(body.faultBreakdown).toHaveLength(2);
    });
  });
});
