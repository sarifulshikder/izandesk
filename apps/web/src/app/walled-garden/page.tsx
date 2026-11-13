export default function WalledGardenPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 space-y-4 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-2xl font-black tracking-tight">Service Restricted (Walled Garden)</h1>
          <p className="text-sm text-muted-foreground">Your internet access is currently restricted due to outstanding dues or an account status policy.</p>
        </div>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200 space-y-1">
          <div className="font-semibold">To restore full service:</div>
          <ul className="list-disc pl-5 space-y-1 text-amber-100/90">
            <li>Pay your outstanding invoice via the IzanDesk billing portal or your available payment method (bKash/Nagad/Rocket/Card/PayPal as enabled).</li>
            <li>Once payment is confirmed, access is restored automatically (target &lt; 2 seconds) without manual intervention.</li>
            <li>If you recently paid and access is not restored, reconnect your PPPoE session or contact support with your Client ID/Username and transaction reference.</li>
          </ul>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <a href="/billing" className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-center">Open Billing / Payments</a>
          <a href="/" className="px-4 py-2.5 rounded-xl border border-border bg-card font-semibold text-center">Go to Portal Home</a>
        </div>
        <div className="text-xs text-muted-foreground">
          If you are seeing this page after redirection by your ISP router/NAS, your account is in a restricted (walled-garden) state. Allowed access is typically limited to payment/portal services while dues are pending.
        </div>
      </div>
    </div>
  );
}