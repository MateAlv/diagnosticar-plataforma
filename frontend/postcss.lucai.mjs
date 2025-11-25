import autoprefixer from "autoprefixer";
import postcssImport from "postcss-import";
import postcssPrefixSelector from "postcss-prefix-selector";

const config = {
  plugins: [
    postcssImport,
    postcssPrefixSelector({
      prefix: "#lucai-app",
      exclude: ["html", "body", ":root"],
      transform(prefix, selector, prefixedSelector) {
        if (selector.startsWith(prefix)) return selector;
        if (selector.startsWith("@")) return selector;
        return prefixedSelector;
      },
    }),
    autoprefixer,
  ],
};

export default config;
