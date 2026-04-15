module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: [
      // If you use Reanimated, it must go here
      // "react-native-reanimated/plugin",
    ],
  };
};
