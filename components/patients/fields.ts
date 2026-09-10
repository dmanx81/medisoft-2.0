import type { PatientInput } from '@/features/patients/validation';
export type PatientField = {
  name: keyof PatientInput;
  label: string;
  type?: 'text' | 'date' | 'email' | 'tel' | 'textarea';
  required?: boolean;
  max?: number;
  options?: { value: string; label: string }[];
  hint?: string;
};
export const formSections: { title: string; fields: PatientField[] }[] = [
  {
    title: 'Personal information',
    fields: [
      { name: 'first_name', label: 'First name', required: true, max: 100 },
      { name: 'last_name', label: 'Last name', required: true, max: 100 },
      { name: 'date_of_birth', label: 'Date of birth', type: 'date' },
      {
        name: 'sex',
        label: 'Sex (clinical record)',
        options: [
          { value: 'UNKNOWN', label: 'Not recorded' },
          { value: 'FEMALE', label: 'Female' },
          { value: 'MALE', label: 'Male' },
          { value: 'INTERSEX', label: 'Intersex' },
        ],
      },
      {
        name: 'national_id',
        label: 'National / personal ID',
        max: 64,
        hint: 'Optional. Verify the identifier before saving.',
      },
    ],
  },
  {
    title: 'Contact information',
    fields: [
      { name: 'phone', label: 'Primary phone', type: 'tel', max: 40 },
      {
        name: 'secondary_phone',
        label: 'Secondary phone',
        type: 'tel',
        max: 40,
      },
      { name: 'email', label: 'Email address', type: 'email', max: 254 },
    ],
  },
  {
    title: 'Address',
    fields: [
      { name: 'address_line_1', label: 'Address line 1', max: 200 },
      { name: 'address_line_2', label: 'Address line 2', max: 200 },
      { name: 'city', label: 'City', max: 100 },
      { name: 'postal_code', label: 'Postal code', max: 20 },
      {
        name: 'country',
        label: 'Country code',
        max: 2,
        hint: 'Two-letter code, for example AL.',
      },
    ],
  },
  {
    title: 'Emergency contact',
    fields: [
      { name: 'emergency_contact_name', label: 'Contact name', max: 160 },
      {
        name: 'emergency_contact_phone',
        label: 'Contact phone',
        type: 'tel',
        max: 40,
      },
    ],
  },
  {
    title: 'Administrative information',
    fields: [
      {
        name: 'preferred_language',
        label: 'Preferred language',
        options: [
          { value: 'sq', label: 'Albanian' },
          { value: 'en', label: 'English' },
        ],
      },
      {
        name: 'status',
        label: 'Patient status',
        options: [
          { value: 'ACTIVE', label: 'Active' },
          { value: 'INACTIVE', label: 'Inactive' },
        ],
        hint: 'Inactive records remain available for historical reference.',
      },
    ],
  },
  {
    title: 'Notes',
    fields: [
      {
        name: 'notes',
        label: 'Administrative notes',
        type: 'textarea',
        max: 4000,
        hint: 'Record only necessary administrative information. Do not enter laboratory results or diagnoses here.',
      },
    ],
  },
];
export const patientFieldLabels = Object.fromEntries(
  formSections.flatMap((section) =>
    section.fields.map((field) => [field.name, field.label]),
  ),
);
