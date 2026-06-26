const { createApp } = require("./app");

const port = Number(process.env.PORT || 8088);

createApp().listen(port, () => {
  console.log(`OA School AI review test repo listening on http://localhost:${port}`);
});
