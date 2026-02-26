import { AttendantService } from './attendant.service';

describe('AttendantService', () => {
  const service = new AttendantService(
    {} as any,
    { get: () => null } as any,
    {} as any,
    {} as any,
  ) as any;

  it('maps known port statuses and falls back unknown to fault', () => {
    expect(service.mapPortStatus('AVAILABLE')).toBe('available');
    expect(service.mapPortStatus('IN_USE')).toBe('in_use');
    expect(service.mapPortStatus('FULL')).toBe('full');
    expect(service.mapPortStatus('mystery')).toBe('fault');
  });

  it('handles overnight shifts when resolving assignment status', () => {
    service.currentMinutesInTimezone = () => 60; // 01:00
    expect(
      service.resolveAssignmentStatus('22:00', '06:00', 'Africa/Kampala', null),
    ).toBe('active');

    service.currentMinutesInTimezone = () => 12 * 60; // 12:00
    expect(
      service.resolveAssignmentStatus('22:00', '06:00', 'Africa/Kampala', null),
    ).toBe('off_shift');
  });

  it('applies assignment status override first', () => {
    service.currentMinutesInTimezone = () => 12 * 60;
    expect(
      service.resolveAssignmentStatus(
        '08:00',
        '16:00',
        'Africa/Kampala',
        'force_active',
      ),
    ).toBe('active');
    expect(
      service.resolveAssignmentStatus(
        '08:00',
        '16:00',
        'Africa/Kampala',
        'force_off_shift',
      ),
    ).toBe('off_shift');
  });
});
