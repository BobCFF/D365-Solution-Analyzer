import next from "eslint-config-next";
import coreWebVitals from "eslint-config-next/core-web-vitals";

// Next.js + react-hooks + jsx-a11y (the same bar as Salesforce Analyzer's Q1/EA1).
const config = [
  ...next,
  ...coreWebVitals,
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
];
export default config;
