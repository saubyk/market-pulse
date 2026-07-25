import { useState } from "react";

type Theme = "light" | "dark";

// Matches the <meta name="theme-color"> values set pre-paint in index.html.
const META_COLOR: Record<Theme, string> = {
  light: "#ffffff",
  dark: "#0b0b0b",
};

function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

// Same mechanism as satusd.com's footer toggle: flip data-theme on <html>
// (all colors are CSS variables keyed off it) and persist to the shared
// localStorage "theme" key so the preference carries across satusd.com and
// satusd.com/market-pulse. Icon visibility is handled in CSS (.theme-btn):
// the button shows the theme it switches *to*.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  function toggle() {
    const next: Theme = currentTheme() === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", META_COLOR[next]);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private mode / storage disabled: theme still flips, just not persisted.
    }
    setTheme(next);
  }

  return (
    <button
      className="theme-btn"
      type="button"
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      onClick={toggle}
    >
      <svg
        className="icon-sun"
        width={15}
        height={15}
        viewBox="0 0 15 15"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
      >
        <circle cx="7.5" cy="7.5" r="3.1" />
        <path d="M7.5 1v1.6M7.5 12.4V14M14 7.5h-1.6M2.6 7.5H1M12.1 2.9l-1.1 1.1M4 11l-1.1 1.1M12.1 12.1L11 11M4 4L2.9 2.9" />
      </svg>
      <svg
        className="icon-moon"
        width={15}
        height={15}
        viewBox="0 0 15 15"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13 9.2A6 6 0 015.8 2 5.9 5.9 0 108 13.5a6 6 0 005-4.3z" />
      </svg>
    </button>
  );
}
