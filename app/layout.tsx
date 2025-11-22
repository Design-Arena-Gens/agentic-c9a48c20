import "../styles/globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "India from Space ? Time?lapse",
  description: "Generate a satellite time?lapse video of India and export as WebM.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>
          <div className="container">{children}</div>
        </main>
      </body>
    </html>
  );
}
