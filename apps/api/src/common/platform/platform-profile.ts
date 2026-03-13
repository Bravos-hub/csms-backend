export type Region = 'china' | 'global';
export type SmsProvider = 'twilio' | 'submail';
export type MediaProvider = 'cloudinary' | 'disabled';

export interface PlatformProfile {
  region: Region;
  smsProvider: SmsProvider;
  mediaProvider: MediaProvider;
}

export function resolveRegion(value?: string): Region {
  return value?.trim().toLowerCase() === 'china' ? 'china' : 'global';
}

export function resolvePlatformProfile(
  env: NodeJS.ProcessEnv = process.env,
): PlatformProfile {
  const region = resolveRegion(env.REGION);

  return {
    region,
    smsProvider:
      (env.SMS_PROVIDER?.trim().toLowerCase() as SmsProvider | undefined) ??
      (region === 'china' ? 'submail' : 'twilio'),
    mediaProvider:
      (env.MEDIA_PROVIDER?.trim().toLowerCase() as MediaProvider | undefined) ??
      (region === 'china' ? 'disabled' : 'cloudinary'),
  };
}
