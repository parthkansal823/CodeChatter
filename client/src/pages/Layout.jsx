import Navbar from "../components/Navbar";

export default function Layout({ children, theme, onThemeChange }) {
  const currentTheme = theme || "vs-dark";

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-zinc-950 text-black dark:text-white">
      <Navbar theme={currentTheme} onThemeChange={onThemeChange} minimal />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
