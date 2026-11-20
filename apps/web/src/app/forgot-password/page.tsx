import Link from 'next/link';

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-4">
      <div className="card w-full max-w-md overflow-hidden">
        <div className="px-6 pt-6 sm:px-8 sm:pt-8">
          <span className="page-eyebrow">IzanDesk · Account recovery</span>
        </div>
        <div className="p-6 sm:p-8 pt-4 space-y-4">
        <div>
          <h1 className="text-xl font-bold">Forgot password</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Staff password resets are managed by your system administrator for security.
          </p>
        </div>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>If you cannot sign in:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Contact your Super Admin or NOC lead to reset your account password.</li>
            <li>If you are a subscriber, use the <Link href="/portal" className="text-primary hover:underline">Customer Self-Care Portal</Link> and the portal password reset/change options available there.</li>
          </ul>
        </div>
        <div className="pt-2 flex gap-2">
          <Link href="/" className="btn btn-primary">
            Back to sign in
          </Link>
          <Link href="/portal" className="btn btn-outline">
            Open portal
          </Link>
        </div>
        </div>
      </div>
    </div>
  );
}
