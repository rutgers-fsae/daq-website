/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        text: "var(--text)",
        muted: "var(--muted)",
        subtle: "var(--subtle)",
        surface: "var(--surface)",
        "surface-soft": "var(--surface-soft)",
        panel: "var(--panel-bg)",
        border: "var(--panel-border)",
        input: "var(--input-bg)",
        "input-border": "var(--input-border)",
        button: "var(--button-bg)",
        "button-hover": "var(--button-bg-hover)",
        "button-text": "var(--button-text)",
        "button-disabled": "var(--button-disabled)",
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        ring: "var(--ring)",
      },
      fontFamily: {
        display: ['Orbitron, "Arial Black", sans-serif'],
        sans: ['"Open Sans", Arial, sans-serif'],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "var(--radius)",
        sm: "var(--radius)",
        card: "31px",
      },
      borderColor: { "accent-line": "var(--accent-line, #ff0000)" },
    },
  },
  plugins: [],
};
