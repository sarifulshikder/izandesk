export default function WalledGardenPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-xl card overflow-hidden">
        <div className="px-6 py-5 border-b border-border bg-card-cap/60 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/10 text-warning border border-warning/20">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
          </span>
          <div>
            <span className="page-eyebrow">Account access · Policy notice</span>
            <h1 className="text-[17px] font-bold text-foreground">Service Restricted</h1>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            Your internet access is currently restricted due to outstanding dues or an account status policy. Full service resumes automatically once your account is clear.
          </p>
          <div className="alert alert-warning">
            <div className="space-y-1.5">
              <div className="font-semibold">To restore full service</div>
              <ul className="list-disc pl-5 space-y-1 text-[12px] leading-relaxed">
                <li>Pay your outstanding invoice via the IzanDesk billing portal or an available payment method (bKash/Nagad/Rocket/Card/PayPal as enabled).</li>
                <li>Once payment is confirmed, access is restored automatically (target &lt; 2 seconds) without manual intervention.</li>
                <li>If you recently paid and access is not restored, reconnect your PPPoE session or contact support with your Client ID/Username and transaction reference.</li>
              </ul>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a href="/billing" className="btn btn-primary justify-center">Open Billing / Payments</a>
            <a href="/" className="btn btn-outline justify-center">Go to Portal Home</a>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            If you are seeing this page after redirection by your ISP router/NAS, your account is in a restricted (walled-garden) state. Allowed access is typically limited to payment and portal services while dues are pending.
          </p>
        </div>
      </div>
    </div>
  );
}