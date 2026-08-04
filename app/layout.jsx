import './globals.css';

export const metadata = {
  title: 'Social Media Dashboard',
  description: 'Public profile data for ATLAS SkillTech University',
};

/**
 * Root layout — wraps every route in the App Router.
 * Replaces index.html and src/main.jsx from the Vite build.
 */
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
