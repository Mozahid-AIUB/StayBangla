export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-border mt-auto border-t">
      <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <span className="text-foreground font-semibold">StayBangla</span> —
          বাংলাদেশ ঘুরে দেখুন
        </p>
        <p>© {year} StayBangla</p>
      </div>
    </footer>
  );
}
