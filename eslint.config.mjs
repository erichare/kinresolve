import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
  {
    ignores: [".next/**", "coverage/**", "node_modules/**"]
  }
];

export default eslintConfig;
