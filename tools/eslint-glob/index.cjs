const path = require("node:path");
const { globSync: tinyGlobSync } = require("tinyglobby");

// Next's ESLint plugin uses only globSync(pattern, { onlyDirectories: true }).
// Preserve fast-glob's exact directory lookup and absolute-pattern behavior.
exports.globSync = (pattern, options = {}) => {
  const matches = tinyGlobSync(pattern, {
    ...options,
    expandDirectories: false,
    absolute: options.absolute ?? (typeof pattern === "string" && path.isAbsolute(pattern))
  });
  return matches.map((match) => (
    match.endsWith("/") && match.length > path.parse(match).root.length
      ? match.slice(0, -1)
      : match
  ));
};
