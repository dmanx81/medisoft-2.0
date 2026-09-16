export function DoctorAccessDenied() {
  return (
    <section role="alert">
      <h1 className="text-2xl font-semibold">Access restricted</h1>
      <p className="mt-3 text-slate">
        Your role does not include doctor administration. Contact your
        organization administrator.
      </p>
    </section>
  );
}
