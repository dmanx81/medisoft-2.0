export type OrganizationBranding = {
  name: string;
  legal_name: string;
  slug: string;
  type: string;
  address: string;
  city: string;
  postal_code: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  registration_number: string;
  logo_asset_id: string;
  has_logo: boolean;
};

export type OrganizationAsset = {
  id: string;
  organization_id: string;
  kind: 'LOGO' | 'DOCTOR_SIGNATURE';
  content_type: 'image/png';
  bytes: Buffer;
  byte_size: number;
  width: number;
  height: number;
  original_filename: string;
};

export type ProcessedImage = {
  bytes: Buffer;
  width: number;
  height: number;
  original_filename: string;
};

export class BrandingError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
