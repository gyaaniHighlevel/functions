import {FilePath} from "../models/project.model";

/** Seed tree for new projects. index.html carries no <script>: the preview
 * shell injects app.js (spec gate 5). */
export const STARTER_TEMPLATE: Readonly<Record<FilePath, string>> = {
  "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Genesis App</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app">
    <h1>Welcome to your new app</h1>
    <p>Describe what you want to build in the chat to get started.</p>
  </div>
</body>
</html>
`,
  "app.js": `const app = document.getElementById("app");

function init() {
  app.querySelector("p").textContent =
    "Describe what you want to build in the chat to get started.";
}

init();
`,
  "styles.css": `:root {
  font-family: system-ui, sans-serif;
}

body {
  margin: 0;
  padding: 2rem;
  background: #fafafa;
  color: #1a1a1a;
}

#app {
  max-width: 640px;
  margin: 0 auto;
}
`,
};
