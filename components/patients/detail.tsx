'use client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { Patient } from '@/features/patients/types';
import { formSections } from './fields';
import { dateLabel } from '@/features/patients/format';
import { Activity } from './activity';
import { PatientOrders } from '@/components/orders/patient-orders';
import { PatientInvoices } from '@/components/billing/patient-invoices';
import { PatientPrescriptions } from '@/components/clinical/patient-prescriptions';
export function PatientDetail({
  patient,
  canActivity,
  canReadOrders = false,
  canCreateOrders = false,
  canReadBilling = false,
  canReadPrescriptions = false,
  canCreatePrescriptions = false,
}: {
  patient: Patient;
  canActivity: boolean;
  canReadOrders?: boolean;
  canCreateOrders?: boolean;
  canReadBilling?: boolean;
  canReadPrescriptions?: boolean;
  canCreatePrescriptions?: boolean;
}) {
  return (
    <Tabs defaultValue="overview">
      <div className="overflow-x-auto border-b border-line">
        <TabsList variant="line" aria-label="Patient sections" className="h-11">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {['Lab Orders', 'Results', 'Documents', 'Prescriptions', 'Billing'].map((label) => (
            <TabsTrigger key={label} value={label}>
              {label}
            </TabsTrigger>
          ))}
          {canActivity && <TabsTrigger value="activity">Activity</TabsTrigger>}
        </TabsList>
      </div>
      <TabsContent value="overview" className="pt-4">
        <div className="grid gap-4 lg:grid-cols-2">
          {formSections.map((section) => (
            <section
              key={section.title}
              className="rounded-md border border-line bg-white p-5"
            >
              <h2 className="mb-4 font-semibold">{section.title}</h2>
              <dl className="grid gap-3">
                {section.fields.map((field) => (
                  <div
                    key={field.name}
                    className="grid grid-cols-[minmax(100px,1fr)_2fr] gap-3"
                  >
                    <dt className="text-sm text-slate">{field.label}</dt>
                    <dd className="whitespace-pre-wrap break-words text-sm">
                      {field.name === 'date_of_birth'
                        ? dateLabel(patient[field.name])
                        : field.options?.find(
                            (option) => option.value === patient[field.name],
                          )?.label ||
                          patient[field.name] ||
                          'Not recorded'}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </TabsContent>
      <TabsContent value="Lab Orders" className="mt-4">
        {canReadOrders ? (
          <PatientOrders
            patientId={patient.id}
            canCreate={canCreateOrders}
          />
        ) : (
          <div className="rounded-md border border-line bg-white p-8">
            <h2 className="font-semibold">Lab Orders</h2>
            <p className="mt-2 text-sm text-slate">
              Your role cannot view laboratory orders for this patient.
            </p>
          </div>
        )}
      </TabsContent>
      {['Results', 'Documents'].map((label) => (
        <TabsContent
          key={label}
          value={label}
          className="mt-4 rounded-md border border-line bg-white p-8"
        >
          <h2 className="font-semibold">{label}</h2>
          <p className="mt-2 text-sm text-slate">
            This section will connect to the patient record in a future release.
          </p>
        </TabsContent>
      ))}
      <TabsContent value="Prescriptions" className="mt-4">
        {canReadPrescriptions ? (
          <PatientPrescriptions
            patientId={patient.id}
            canCreate={canCreatePrescriptions}
          />
        ) : (
          <div className="rounded-md border border-line bg-white p-8">
            <h2 className="font-semibold">Prescriptions</h2>
            <p className="mt-2 text-sm text-slate">
              Your role cannot view prescriptions for this patient.
            </p>
          </div>
        )}
      </TabsContent>
      <TabsContent value="Billing" className="mt-4">
        {canReadBilling ? (
          <PatientInvoices patientId={patient.id} />
        ) : (
          <div className="rounded-md border border-line bg-white p-8">
            <h2 className="font-semibold">Billing</h2>
            <p className="mt-2 text-sm text-slate">
              Your role cannot view invoices for this patient.
            </p>
          </div>
        )}
      </TabsContent>
      {canActivity && (
        <TabsContent
          value="activity"
          className="mt-4 rounded-md border border-line bg-white p-5"
        >
          <Activity patientId={patient.id} />
        </TabsContent>
      )}
    </Tabs>
  );
}
